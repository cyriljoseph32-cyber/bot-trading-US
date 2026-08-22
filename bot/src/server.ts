/* ─── Serveur dashboard/API (node:http, sans dépendance) ───────────────────
 *
 * Écoute sur 127.0.0.1 par défaut (BOT_BIND pour exposer sur le LAN).
 * Ne sert QUE des données calculées — jamais de clé API ni de secret.
 * Le kill switch et le réarmement du disjoncteur sont pilotables en POST.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Instrument, PortfolioSnapshot, ScoredSignal } from "./types";
import type { FeedStatus } from "./provider/provider";
import type { RiskEngine } from "./risk/engine";
import { isMarketOpen } from "./sessions";
import { logger } from "./log";

export interface BotState {
  feedStatus: () => FeedStatus;
  feedDetail: () => string;
  universe: () => Instrument[];
  signals: () => ScoredSignal[];
  portfolio: () => PortfolioSnapshot;
  risk: RiskEngine;
  quotesAgeMs: () => Record<string, number>;
  startedAt: number;
  /** Présent uniquement quand le processus fait tourner SPC FX5. */
  spcfx5?: SpcFx5State;
}

/** Vues exposées par la stratégie SPC FX5 (données déjà calculées). */
export interface SpcFx5State {
  signals: () => unknown[];
  ranked: () => unknown[];
  universe: () => unknown;
  governor: () => unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export function startServer(state: BotState, port: number, bind = "127.0.0.1"): void {
  const dashboardPath = join(import.meta.dirname, "dashboard.html");

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      logger.error("server", String(e));
      json(res, 500, { error: "internal" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET") {
      switch (path) {
        case "/":
        case "/index.html": {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(readFileSync(dashboardPath, "utf-8"));
          return;
        }
        case "/api/status": {
          const now = Date.now();
          json(res, 200, {
            startedAt: new Date(state.startedAt).toISOString(),
            uptimeSec: Math.round((now - state.startedAt) / 1000),
            markets: state.universe().map((i) => ({
              symbol: i.symbol,
              exchange: i.exchange,
              open: isMarketOpen(i.assetClass, i.exchange, now),
            })),
          });
          return;
        }
        case "/api/health": {
          json(res, 200, {
            feed: state.feedStatus(),
            detail: state.feedDetail(),
            quotesAgeMs: state.quotesAgeMs(),
          });
          return;
        }
        case "/api/universe": {
          json(res, 200, state.universe());
          return;
        }
        case "/api/signals": {
          // Classés par score décroissant — la watchlist priorisée.
          json(res, 200, [...state.signals()].sort((a, b) => b.score - a.score));
          return;
        }
        case "/api/positions": {
          json(res, 200, state.portfolio().positions);
          return;
        }
        case "/api/pnl": {
          const p = state.portfolio();
          json(res, 200, {
            baseCurrency: p.baseCurrency,
            equity: p.equity,
            cash: p.cash,
            realizedPnl: p.realizedPnl,
            unrealizedPnl: p.unrealizedPnl,
            dayPnl: Math.round((p.equity - p.dayStartEquity) * 100) / 100,
          });
          return;
        }
        case "/api/risk": {
          json(res, 200, {
            params: state.risk.params,
            circuitOpen: state.risk.isCircuitOpen(),
            dailyLossPct: Math.round(state.risk.dailyLossPct(state.portfolio()) * 100) / 100,
          });
          return;
        }
        case "/api/logs": {
          json(res, 200, logger.recent(150));
          return;
        }
        case "/api/spcfx5/signals": {
          if (!state.spcfx5) return json(res, 404, { error: "spcfx5_not_running" });
          // Classement complet : score, détail par composant, rejets, rang.
          json(res, 200, state.spcfx5.ranked());
          return;
        }
        case "/api/spcfx5/rejects": {
          if (!state.spcfx5) return json(res, 404, { error: "spcfx5_not_running" });
          // Tous les setups NON retenus, avec la raison exacte.
          const signals = state.spcfx5.signals() as Array<{ eligible?: boolean }>;
          json(res, 200, signals.filter((s) => s.eligible !== true));
          return;
        }
        case "/api/spcfx5/universe": {
          if (!state.spcfx5) return json(res, 404, { error: "spcfx5_not_running" });
          json(res, 200, state.spcfx5.universe());
          return;
        }
        case "/api/spcfx5/portfolio": {
          if (!state.spcfx5) return json(res, 404, { error: "spcfx5_not_running" });
          json(res, 200, state.spcfx5.governor());
          return;
        }
      }
    }

    if (req.method === "POST") {
      if (path === "/api/risk/kill") {
        const body = JSON.parse((await readBody(req)) || "{}") as { on?: boolean };
        state.risk.params.killSwitch = body.on === true;
        logger.warn("risk", `kill switch ${state.risk.params.killSwitch ? "ACTIVÉ" : "désactivé"} via API`);
        json(res, 200, { killSwitch: state.risk.params.killSwitch });
        return;
      }
      if (path === "/api/risk/reset-circuit") {
        state.risk.resetCircuit();
        logger.warn("risk", "disjoncteur réarmé via API");
        json(res, 200, { circuitOpen: false });
        return;
      }
    }

    json(res, 404, { error: "not_found" });
  }

  server.listen(port, bind, () => {
    logger.info("server", `dashboard sur http://${bind}:${port}`);
  });
}
