/* ─── SPC FX5 Multi-Asset 100 — point d'entrée (paper par défaut) ──────────
 *
 * Scanne jusqu'à 100 actifs en H1, classe les setups par score de qualité,
 * arbitre le risque portefeuille et exécute en PAPER. Le bot 15m existant
 * (`npm run bot:paper`) n'est pas touché : ce sont deux processus distincts.
 *
 * CADENCE : la stratégie n'entre qu'à la clôture d'une bougie H1. On sonde
 * donc l'historique H1 en REST une fois par heure, plutôt que d'ouvrir un
 * WebSocket — dont le plan gratuit Twelve Data limite l'usage à 8 symboles.
 * H4 et D1 sont dérivés localement des bougies H1 closes : zéro crédit
 * supplémentaire, et aucun lookahead possible.
 *
 * ⚠ CRÉDITS API : 100 symboles = ~100 crédits REST par heure (~2 400/jour).
 * L'offre gratuite (800/jour) ne suffit pas — baissez SPC_MAX_SYMBOLS ou
 * passez sur un plan payant. Le bot le dit au démarrage.
 *
 * SÉCURITÉ : aucun ordre réel ne peut partir d'ici (OrderRouter exige
 * LIVE_TRADING=true ET un adaptateur réel, qui n'existe pas dans ce dépôt).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./env";
import { logger } from "./log";
import { JsonlStore } from "./store";
import { TwelveDataProvider } from "./provider/twelvedata";
import { PaperBroker } from "./exec/paper";
import { OrderRouter } from "./exec/router";
import { RiskEngine, DEFAULT_GLOBAL_RISK } from "./risk/engine";
import { PortfolioGovernor, DEFAULT_SPC_PORTFOLIO } from "./risk/portfolio";
import { startServer } from "./server";
import { SpcEngine } from "./strategy/spcfx5/engine";
import { DEFAULT_SPC_PARAMS, mergeParams } from "./strategy/spcfx5/params";
import {
  loadSpcConfig,
  selectSpcUniverse,
  correlationOverrides,
  costBpsOf,
} from "./strategy/spcfx5/universe";
import type { NewsEvent } from "./strategy/spcfx5/filters";
import type { SpcUniverseEntry } from "./strategy/spcfx5/types";
import type { Instrument } from "./types";

const POLL_INTERVAL_MS = 5 * 60_000; // vérification d'une nouvelle bougie H1
const HISTORY_BARS = 260; // SMA 200 + marge ADX/pente

/** Charge le fichier d'annonces macro ; null si absent (filtre neutre). */
function loadNews(path: string | undefined): NewsEvent[] | null {
  if (!path) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { events?: NewsEvent[] } | NewsEvent[];
    const events = Array.isArray(raw) ? raw : (raw.events ?? []);
    logger.info("spcfx5", `${events.length} annonces macro chargées depuis ${path}`);
    return events;
  } catch (e) {
    logger.warn("spcfx5", `flux d'actualités illisible (${path}) : ${String(e)} — filtre neutre`);
    return null;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info("boot", `SPC FX5 Multi-Asset — LIVE_TRADING=${env.liveTrading} (paper par défaut)`);

  /* ─── Configuration et univers ─────────────────────────────────────── */
  const configPath =
    env.spcConfigPath ?? join(import.meta.dirname, "..", "config", "spcfx5.json");
  const config = loadSpcConfig(configPath);
  const params = mergeParams(DEFAULT_SPC_PARAMS, config.params ?? {});
  if (!env.spcSessionFilter) {
    params.session = { ...params.session, enabled: false };
    logger.warn("spcfx5", "SPC_SESSION_FILTER=false — filtre de session DÉSACTIVÉ");
  }

  const { selected, skipped } = selectSpcUniverse(config, env.spcMaxSymbols);
  logger.info(
    "spcfx5",
    `${selected.length} actifs suivis, ${skipped.length} ignorés ` +
      `(${skipped.filter((s) => s.reason === "disabled").length} désactivés dans la config)`
  );
  if (selected.length === 0) {
    logger.error("spcfx5", "aucun actif actif dans la watchlist — rien à faire");
    return;
  }

  // Budget de crédits REST : 1 requête par symbole et par heure.
  const creditsPerDay = selected.length * 24;
  logger.info(
    "spcfx5",
    `budget REST estimé : ${selected.length} crédits/heure (~${creditsPerDay}/jour). ` +
      `Plan déclaré : ${env.tdRestRpm}/min. L'offre gratuite Twelve Data plafonne à 800/jour.`
  );

  /* ─── Composants ───────────────────────────────────────────────────── */
  const store = new JsonlStore(env.dataDir);
  const provider = new TwelveDataProvider(env.twelveDataApiKey, env.tdRestRpm);
  const broker = new PaperBroker(env.paperCapital, env.baseCurrency);
  broker.registerInstruments(selected.map((s) => s.instrument));
  const router = new OrderRouter(broker, env.liveTrading, null);
  const risk = new RiskEngine({ ...DEFAULT_GLOBAL_RISK, killSwitch: env.killSwitch });
  const governor = new PortfolioGovernor(
    {
      ...DEFAULT_SPC_PORTFOLIO,
      ...(config.portfolio ?? {}),
      correlationGroupOverrides: correlationOverrides(config),
    },
    env.paperCapital
  );

  const engine = new SpcEngine({
    config,
    universe: selected,
    params,
    broker,
    router,
    risk,
    governor,
    store,
    news: loadNews(env.spcNewsFile),
  });

  // Taux FX du portefeuille papier : alimentés par les paires suivies.
  const updateFxRates = (entry: SpcUniverseEntry, price: number): void => {
    if (entry.asset.assetClass !== "fx") return;
    const [from, to] = entry.asset.std.match(/^([A-Z]{3})([A-Z]{3})$/)?.slice(1) ?? [];
    if (!from || !to || !(price > 0)) return;
    if (to === env.baseCurrency) broker.updateFxRate(from, price);
    else if (from === env.baseCurrency) broker.updateFxRate(to, 1 / price);
  };

  /**
   * Publication des signaux retenus sur un webhook — signaux STRUCTURÉS,
   * prêts pour une exécution externe. N'envoie que des données calculées :
   * aucune clé API ne sort d'ici. Un échec est journalisé, jamais fatal.
   */
  async function publishWebhook(retained: ReturnType<typeof engine.ranked>): Promise<void> {
    if (!env.spcWebhookUrl || retained.length === 0) return;
    try {
      const res = await fetch(env.spcWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy: "spcfx5",
          ts: new Date().toISOString(),
          signals: retained.map((r) => ({
            std: r.signal.std,
            symbol: r.signal.symbol,
            side: r.signal.side,
            score: r.signal.score,
            rank: r.rank,
            price: r.signal.price,
            stopLoss: r.signal.stopLoss,
            takeProfit: r.signal.takeProfit,
            rrNet: r.signal.rrNet,
            riskPct: r.riskPct,
            parts: r.signal.parts,
            notes: r.signal.notes,
          })),
        }),
      });
      if (!res.ok) logger.warn("spcfx5", `webhook refusé (HTTP ${res.status})`);
    } catch (e) {
      logger.warn("spcfx5", `webhook injoignable : ${String(e)}`);
    }
  }

  /* ─── Boucle de sondage H1 ─────────────────────────────────────────── */
  const lastBarSeen = new Map<string, number>();

  async function pollSymbol(entry: SpcUniverseEntry, count: number): Promise<boolean> {
    const bars = await provider.fetchHistory(entry.instrument, "1h", count);
    if (bars.length === 0) return false;
    const costBps = costBpsOf(entry.asset, config) ?? params.cost.defaultCostBps;
    const previous = lastBarSeen.get(entry.instrument.symbol) ?? 0;
    let fresh = false;
    for (const bar of bars) {
      if (bar.openTime <= previous) continue;
      engine.ingestBar(entry, bar, costBps);
      updateFxRates(entry, bar.close);
      store.saveBar(bar);
      fresh = true;
    }
    const latest = bars[bars.length - 1];
    lastBarSeen.set(entry.instrument.symbol, latest.openTime);
    return fresh;
  }

  async function poll(initial: boolean): Promise<void> {
    if (!env.twelveDataApiKey) return;
    let anyFresh = false;
    for (const entry of selected) {
      try {
        const fresh = await pollSymbol(entry, initial ? HISTORY_BARS : 3);
        anyFresh = anyFresh || fresh;
      } catch (e) {
        logger.warn("spcfx5", `historique H1 indisponible pour ${entry.asset.std} : ${String(e)}`);
        risk.recordFailure();
      }
    }
    if (!anyFresh && !initial) return;
    const result = engine.runCycle(Date.now());
    const retained = result.ranked.filter((r) => r.selected).length;
    logger.info(
      "spcfx5",
      `cycle H1 — ${result.signals.filter((s) => s.eligible).length} setups éligibles, ` +
        `${retained} retenus, ${result.submitted.length} ordres soumis`
    );
    await publishWebhook(result.ranked.filter((r) => r.selected));
    store.saveRecord("spcfx5-cycles", {
      ts: new Date().toISOString(),
      eligible: result.signals.filter((s) => s.eligible).length,
      retained,
      submitted: result.submitted.length,
      governor: governor.snapshot(broker.snapshot().equity),
    });
  }

  if (env.twelveDataApiKey) {
    void poll(true).then(() => {
      setInterval(() => void poll(false), POLL_INTERVAL_MS);
    });
  } else {
    logger.warn(
      "spcfx5",
      "TWELVEDATA_API_KEY absente — mode dégradé : dashboard et API up, aucun signal calculé"
    );
  }

  /* ─── Dashboard / API ──────────────────────────────────────────────── */
  const instruments: Instrument[] = selected.map((s) => s.instrument);
  startServer(
    {
      feedStatus: () => (env.twelveDataApiKey ? "connected" : "unconfigured"),
      feedDetail: () => `SPC FX5 — ${selected.length} actifs en H1 (sondage REST)`,
      universe: () => instruments,
      signals: () => [],
      portfolio: () => broker.snapshot(),
      risk,
      quotesAgeMs: () => ({}),
      startedAt: Date.now(),
      spcfx5: {
        signals: () => engine.signals(),
        ranked: () => engine.ranked(),
        universe: () => ({ selected, skipped }),
        governor: () => governor.snapshot(broker.snapshot().equity),
      },
    },
    env.port,
    process.env.BOT_BIND ?? "127.0.0.1"
  );

  logger.info("boot", "SPC FX5 prêt — ANALYSE + PAPER (aucun ordre réel possible)");
}

main().catch((e) => {
  console.error("Échec du démarrage SPC FX5 :", e);
  process.exit(1);
});
