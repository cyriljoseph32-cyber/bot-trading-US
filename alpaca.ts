export const config = { runtime: "edge" };

import { analyzeMarket, type SignalRow } from "./_lib/engine";
import {
  alpacaConfigured,
  closePosition,
  getAccount,
  getOrders,
  getPositions,
  isLive,
  submitBuyWithStop,
} from "./_lib/alpaca";
import {
  buildAlertHtml,
  emailConfigured,
  sendEmail,
  type ExecutionReport,
} from "./_lib/email";
import { entriesHalted, evaluateEntry, type RiskState } from "../src/trading/risk";
import { riskParams } from "./_lib/env";
import {
  dbConfigured,
  insertOrders,
  insertRun,
  insertSignals,
  insertSnapshot,
  type OrderRow,
  type SnapshotRow,
} from "./_lib/db";

/* ─── Tâche quotidienne (Vercel Cron, après la clôture de Wall Street) ────
 *
 * 1. Analyse les actifs de la watchlist
 * 2. Si trading auto activé (AUTOTRADE="true" + clés Alpaca) :
 *    passe les ordres d'achat (avec stop attaché) et de sortie
 * 3. Envoie l'alerte email (Resend) s'il y a des signaux
 *
 * Sécurité : compte paper (fictif) par défaut ; le réel exige ALPACA_LIVE="true".
 * Endpoint protégé par CRON_SECRET (en-tête "Authorization: Bearer …",
 * envoyé automatiquement par Vercel Cron).
 */

export default async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { rows, errors } = await analyzeMarket();
  const buys = rows.filter((x) => x.r.action === "ACHETER" && x.r.entryPlan);
  const sells = rows.filter((x) => x.r.action === "VENDRE");
  const holds = rows.filter((x) => x.r.action === "CONSERVER" && x.r.open);

  const params = riskParams();
  const riskPct = params.riskPct;
  let capital = Number(process.env.DEFAULT_CAPITAL ?? "10000");

  const autotrade = process.env.AUTOTRADE === "true" && alpacaConfigured();
  const executions: ExecutionReport[] = [];
  const orderRecords: OrderRow[] = []; // ordres structurés pour le journal
  let snapshot: SnapshotRow | null = null;

  if (autotrade) {
    try {
      const [account, positions, recentOrders] = await Promise.all([
        getAccount(),
        getPositions(),
        getOrders(100),
      ]);
      capital = Number(account.equity) || capital;
      const held = new Set(positions.map((p) => p.symbol));

      // État pour le moteur de risque.
      const today = new Date().toISOString().slice(0, 10);
      let tradesToday = recentOrders.filter(
        (o) =>
          o.side === "buy" &&
          o.submitted_at?.slice(0, 10) === today &&
          o.status !== "canceled" &&
          o.status !== "rejected"
      ).length;
      let openCount = positions.length;
      const state: RiskState = {
        equity: Number(account.equity) || capital,
        lastEquity: Number(account.last_equity) || Number(account.equity) || capital,
        openPositions: openCount,
        tradesToday,
      };

      // Photo du compte au moment de l'exécution (courbe d'equity).
      snapshot = {
        equity: Number(account.equity),
        cash: Number(account.cash),
        buying_power: Number(account.buying_power),
        live: isLive(),
        positions,
      };

      // Sorties d'abord (libère du cash), puis entrées.
      for (const { symbol, r } of sells) {
        if (!held.has(symbol)) continue; // jamais entré chez le courtier
        try {
          const res = await closePosition(symbol);
          orderRecords.push({
            run_id: null, symbol, side: "sell", type: "market",
            status: "ok", broker_order_id: res?.id ?? null, live: isLive(),
          });
          executions.push({
            line: `SORTIE ${symbol} : position liquidée (${r.exitReason ?? "sortie"})`,
            ok: true,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          orderRecords.push({
            run_id: null, symbol, side: "sell", type: "market",
            status: "failed", error: msg, live: isLive(),
          });
          executions.push({ line: `SORTIE ${symbol} ÉCHOUÉE : ${msg}`, ok: false });
        }
      }

      // Halte globale éventuelle (kill switch / perte du jour). Les sorties
      // ont déjà été exécutées ci-dessus — seules les ENTRÉES sont concernées.
      const halt = entriesHalted(params, state);
      if (halt.halted && buys.length > 0) {
        executions.push({ line: `Entrées suspendues — ${halt.detail}`, ok: false });
      }

      for (const { symbol, r } of buys) {
        if (held.has(symbol)) continue; // déjà en position : pas de doublon
        const plan = r.entryPlan!;

        // Le moteur de risque décide : autorisé ? et avec quelle taille ?
        const decision = evaluateEntry(
          { symbol, entry: plan.entry, stop: plan.stop },
          params,
          { ...state, openPositions: openCount, tradesToday }
        );
        if (!decision.approved) {
          orderRecords.push({
            run_id: null, symbol, side: "buy", type: "market",
            stop_price: plan.stop, status: "rejected",
            error: `${decision.reason}: ${decision.detail ?? ""}`, live: isLive(),
          });
          executions.push({
            line: `ACHAT ${symbol} refusé (${decision.reason}) : ${decision.detail ?? ""}`,
            ok: false,
          });
          continue;
        }

        const qty = decision.qty;
        try {
          const res = await submitBuyWithStop(symbol, qty, plan.stop);
          orderRecords.push({
            run_id: null, symbol, side: "buy", qty, type: "market",
            stop_price: plan.stop, status: "ok",
            broker_order_id: res?.id ?? null, live: isLive(),
          });
          openCount++;     // mise à jour pour la décision suivante
          tradesToday++;
          executions.push({
            line: `ACHAT ${symbol} : ${qty} action(s) au marché, stop ${plan.stop.toFixed(2)} $`,
            ok: true,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          orderRecords.push({
            run_id: null, symbol, side: "buy", qty, type: "market",
            stop_price: plan.stop, status: "failed", error: msg, live: isLive(),
          });
          executions.push({ line: `ACHAT ${symbol} ÉCHOUÉ : ${msg}`, ok: false });
        }
      }
    } catch (e) {
      executions.push({
        line: `Trading auto indisponible : ${e instanceof Error ? e.message : e}`,
        ok: false,
      });
    }
  }

  let emailStatus = "non configuré";
  const shouldSend =
    buys.length > 0 ||
    sells.length > 0 ||
    executions.length > 0 ||
    process.env.ALERT_ALWAYS === "true";
  if (emailConfigured() && shouldSend) {
    try {
      const { subject, html } = buildAlertHtml({
        buys,
        sells,
        holds,
        capital,
        riskPct,
        executions,
        autotrade,
        live: isLive(),
        errors,
      });
      await sendEmail(subject, html);
      emailStatus = "envoyé";
    } catch (e) {
      emailStatus = `échec : ${e instanceof Error ? e.message : e}`;
    }
  } else if (emailConfigured()) {
    emailStatus = "rien à signaler (non envoyé)";
  }

  // ─── Journalisation (best-effort : ne bloque JAMAIS le trading) ──────────
  let journaled = false;
  if (dbConfigured()) {
    try {
      const runId = await insertRun({
        analysed: rows.length,
        buys: buys.length,
        sells: sells.length,
        holds: holds.length,
        autotrade,
        live: isLive(),
        email_status: emailStatus,
        errors,
      });
      await insertSignals(
        rows.map(({ symbol, r }) => ({
          run_id: runId,
          symbol,
          action: r.action,
          trend: r.trend,
          last_close: r.lastClose,
          rsi2: r.rsi2,
          rsi14: r.rsi14,
          sma200: r.sma200,
          entry: r.entryPlan?.entry ?? null,
          stop: r.entryPlan?.stop ?? null,
          win_rate: r.winRate,
          exit_reason: r.exitReason,
        }))
      );
      await insertOrders(orderRecords.map((o) => ({ ...o, run_id: runId })));
      if (snapshot) await insertSnapshot(snapshot);
      journaled = true;
    } catch (e) {
      console.error("[cron] journalisation échouée:", e);
    }
  }

  const summary = (x: SignalRow) => x.symbol;
  return new Response(
    JSON.stringify({
      date: new Date().toISOString(),
      analysed: rows.length,
      buys: buys.map(summary),
      sells: sells.map(summary),
      holds: holds.map(summary),
      autotrade,
      live: isLive(),
      executions: executions.map((e) => e.line),
      email: emailStatus,
      journaled,
      errors,
    }),
    { headers: { "content-type": "application/json" } }
  );
}
