export const config = { runtime: "edge" };

import { analyzeMarket, type SignalRow } from "./_lib/engine";
import {
  alpacaConfigured,
  closePosition,
  getAccount,
  getOrders,
  getPositions,
  isLive,
  submitLimitBuyWithStop,
  type AlpacaOrder,
} from "./_lib/alpaca";
import {
  buildAlertHtml,
  emailConfigured,
  sendEmail,
  type ExecutionReport,
} from "./_lib/email";
import { entriesHalted, evaluateEntry, type RiskState } from "../src/trading/risk";
import { PARAMS } from "../src/trading/strategy";
import { env, riskParams } from "./_lib/env";
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
 * 1. Analyse la watchlist (et vérifie la FRAÎCHEUR des données — fix #10).
 * 2. Si trading auto activé :
 *    • SORTIES pilotées par les positions RÉELLES chez Alpaca (fix #2),
 *    • ENTRÉES en ordre LIMITE + stop attaché (fix #1), bornées par le
 *      moteur de risque incluant un plafond d'exposition brute (fix #5).
 * 3. Envoie l'alerte email (Resend) s'il y a des signaux.
 *
 * Sécurité : compte paper par défaut ; le réel exige ALPACA_LIVE="true".
 * Endpoint protégé par CRON_SECRET.
 */

/** Nombre de jours ouvrés écoulés depuis le dernier achat exécuté du symbole. */
function tradingDaysSinceLastBuy(orders: AlpacaOrder[], symbol: string): number | null {
  const buys = orders
    .filter((o) => o.symbol === symbol && o.side === "buy" && Number(o.filled_qty) > 0 && o.filled_avg_price)
    .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  if (!buys.length) return null;
  const from = new Date(buys[0].submitted_at);
  if (isNaN(from.getTime())) return null;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date();
  let d = 0;
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) d++;
  }
  return d;
}

export default async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { rows, errors, stale, asOf } = await analyzeMarket();
  const buys = rows.filter((x) => x.r.action === "ACHETER" && x.r.entryPlan);
  // Résumé informatif (email) issu de l'analyse ; les ORDRES, eux, sont pilotés
  // par les positions réelles plus bas.
  const sells = rows.filter((x) => x.r.action === "VENDRE");
  const holds = rows.filter((x) => x.r.action === "CONSERVER" && x.r.open);

  const params = riskParams();
  const riskPct = params.riskPct;
  let capital = env.defaultCapital(); // fix #11 : valeur validée/bornée

  // Fix #10 : données figées (jour férié / Yahoo en retard) → aucun ordre.
  const dataFresh = !stale;
  const autotrade =
    process.env.AUTOTRADE === "true" && alpacaConfigured() && dataFresh;
  if (process.env.AUTOTRADE === "true" && alpacaConfigured() && stale) {
    errors.push("Données non fraîches (dernière bougie ≠ jour de bourse courant) — aucun ordre passé.");
  }

  const executions: ExecutionReport[] = [];
  const orderRecords: OrderRow[] = [];
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
      const rowMap = new Map(rows.map((x) => [x.symbol, x.r]));

      const today = new Date().toISOString().slice(0, 10);
      let tradesToday = recentOrders.filter(
        (o) =>
          o.side === "buy" &&
          o.submitted_at?.slice(0, 10) === today &&
          o.status !== "canceled" &&
          o.status !== "rejected"
      ).length;
      let openCount = positions.length;
      let investedValue = positions.reduce((s, p) => s + (Number(p.market_value) || 0), 0);

      const state: RiskState = {
        equity: Number(account.equity) || capital,
        lastEquity: Number(account.last_equity) || Number(account.equity) || capital,
        openPositions: openCount,
        tradesToday,
        investedValue,
      };

      snapshot = {
        equity: Number(account.equity),
        cash: Number(account.cash),
        buying_power: Number(account.buying_power),
        live: isLive(),
        positions,
      };

      // ─── SORTIES : pilotées par les positions RÉELLES (fix #2) ───────────
      // Le stop est géré en intra-day par Alpaca ; ici on couvre la prise de
      // profit (clôture > MM5) et la sortie temps, sur ce qu'on détient VRAIMENT.
      for (const pos of positions) {
        const r = rowMap.get(pos.symbol);
        if (!r) {
          executions.push({
            line: `${pos.symbol} : conservé (pas d'analyse aujourd'hui, stop courtier actif)`,
            ok: true,
          });
          continue;
        }
        const daysHeld = tradingDaysSinceLastBuy(recentOrders, pos.symbol);
        let reason: "objectif" | "temps" | null = null;
        if (r.sma5 != null && r.lastClose > r.sma5) reason = "objectif";
        else if (daysHeld != null && daysHeld >= PARAMS.maxHoldDays) reason = "temps";
        if (!reason) continue; // CONSERVER

        try {
          const res = await closePosition(pos.symbol);
          openCount = Math.max(0, openCount - 1);
          investedValue = Math.max(0, investedValue - (Number(pos.market_value) || 0));
          orderRecords.push({
            run_id: null, symbol: pos.symbol, side: "sell", type: "market",
            status: "ok", broker_order_id: res?.id ?? null, live: isLive(),
          });
          executions.push({ line: `SORTIE ${pos.symbol} : position liquidée (${reason})`, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          orderRecords.push({
            run_id: null, symbol: pos.symbol, side: "sell", type: "market",
            status: "failed", error: msg, live: isLive(),
          });
          executions.push({ line: `SORTIE ${pos.symbol} ÉCHOUÉE : ${msg}`, ok: false });
        }
      }

      // Halte globale éventuelle (kill switch / perte du jour) — entrées seules.
      const halt = entriesHalted(params, state);
      if (halt.halted && buys.length > 0) {
        executions.push({ line: `Entrées suspendues — ${halt.detail}`, ok: false });
      }

      // ─── ENTRÉES : ordre LIMITE + stop attaché (fix #1) ──────────────────
      const slippagePct = env.entrySlippagePct();
      for (const { symbol, r } of buys) {
        if (held.has(symbol)) continue; // déjà en position : pas de doublon
        const plan = r.entryPlan!;

        const decision = evaluateEntry(
          { symbol, entry: plan.entry, stop: plan.stop },
          params,
          { ...state, openPositions: openCount, tradesToday, investedValue }
        );
        if (!decision.approved) {
          orderRecords.push({
            run_id: null, symbol, side: "buy", type: "limit",
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
        const limit = plan.entry * (1 + slippagePct / 100);
        try {
          const res = await submitLimitBuyWithStop(symbol, qty, limit, plan.stop);
          openCount++;
          tradesToday++;
          investedValue += qty * plan.entry;
          orderRecords.push({
            run_id: null, symbol, side: "buy", qty, type: "limit",
            stop_price: plan.stop, status: "ok",
            broker_order_id: res?.id ?? null, live: isLive(),
          });
          executions.push({
            line: `ACHAT ${symbol} : ${qty} action(s) à cours limité ≤ ${limit.toFixed(2)} $, stop ${plan.stop.toFixed(2)} $`,
            ok: true,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          orderRecords.push({
            run_id: null, symbol, side: "buy", qty, type: "limit",
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
        buys, sells, holds, capital, riskPct, executions,
        autotrade, live: isLive(), errors,
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
        analysed: rows.length, buys: buys.length, sells: sells.length,
        holds: holds.length, autotrade, live: isLive(),
        email_status: emailStatus, errors,
      });
      await insertSignals(
        rows.map(({ symbol, r, score, winRateNet }) => ({
          run_id: runId,
          symbol,
          action: r.action,
          score: score ?? null,
          trend: r.trend,
          last_close: r.lastClose,
          rsi2: r.rsi2,
          rsi14: r.rsi14,
          sma200: r.sma200,
          entry: r.entryPlan?.entry ?? null,
          stop: r.entryPlan?.stop ?? null,
          win_rate: winRateNet ?? r.winRate, // fix #3 : win-rate NET journalisé
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
      asOf,
      stale,
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
