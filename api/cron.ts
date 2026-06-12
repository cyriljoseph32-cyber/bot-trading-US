export const config = { runtime: "edge" };

import { analyzeMarket, type SignalRow } from "./_lib/engine";
import {
  alpacaConfigured,
  closePosition,
  getAccount,
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
import { positionSize } from "../src/trading/strategy";

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

  const riskPct = Number(process.env.RISK_PCT ?? "1");
  let capital = Number(process.env.DEFAULT_CAPITAL ?? "10000");

  const autotrade = process.env.AUTOTRADE === "true" && alpacaConfigured();
  const executions: ExecutionReport[] = [];

  if (autotrade) {
    try {
      const [account, positions] = await Promise.all([
        getAccount(),
        getPositions(),
      ]);
      capital = Number(account.equity) || capital;
      const held = new Set(positions.map((p) => p.symbol));

      // Sorties d'abord (libère du cash), puis entrées.
      for (const { symbol, r } of sells) {
        if (!held.has(symbol)) continue; // jamais entré chez le courtier
        try {
          await closePosition(symbol);
          executions.push({
            line: `SORTIE ${symbol} : position liquidée (${r.exitReason ?? "sortie"})`,
            ok: true,
          });
        } catch (e) {
          executions.push({
            line: `SORTIE ${symbol} ÉCHOUÉE : ${e instanceof Error ? e.message : e}`,
            ok: false,
          });
        }
      }

      for (const { symbol, r } of buys) {
        if (held.has(symbol)) continue; // déjà en position : pas de doublon
        const plan = r.entryPlan!;
        const qty = positionSize(capital, riskPct, plan.entry, plan.stop);
        if (qty < 1) {
          executions.push({
            line: `ACHAT ${symbol} ignoré : capital insuffisant pour 1 action au risque ${riskPct} %`,
            ok: false,
          });
          continue;
        }
        try {
          await submitBuyWithStop(symbol, qty, plan.stop);
          executions.push({
            line: `ACHAT ${symbol} : ${qty} action(s) au marché, stop ${plan.stop.toFixed(2)} $`,
            ok: true,
          });
        } catch (e) {
          executions.push({
            line: `ACHAT ${symbol} ÉCHOUÉ : ${e instanceof Error ? e.message : e}`,
            ok: false,
          });
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
      errors,
    }),
    { headers: { "content-type": "application/json" } }
  );
}
