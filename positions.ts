import { NAMES } from "../../src/trading/data";
import { positionSize, type ExitReason } from "../../src/trading/strategy";
import type { SignalRow } from "./engine";

/* ─── Alertes email via Resend (https://resend.com) ───────────────────────
 *
 * Variables d'environnement :
 *   RESEND_API_KEY : clé API Resend
 *   ALERT_EMAIL    : destinataire (ex. votre Gmail)
 *   EMAIL_FROM     : expéditeur (défaut : onboarding@resend.dev, utilisable
 *                    sans domaine vérifié, vers l'email du compte Resend)
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL);
}

const fmt$ = (v: number) => v.toFixed(2);
const EXIT_LABEL: Record<ExitReason, string> = {
  objectif: "objectif atteint (clôture > MM5) ✅",
  stop: "stop touché 🔻",
  temps: "délai de 10 séances atteint",
};

export interface ExecutionReport {
  line: string;
  ok: boolean;
}

export function buildAlertHtml(opts: {
  buys: SignalRow[];
  sells: SignalRow[];
  holds: SignalRow[];
  capital: number;
  riskPct: number;
  executions: ExecutionReport[];
  autotrade: boolean;
  live: boolean;
  errors: string[];
}): { subject: string; html: string } {
  const { buys, sells, holds, capital, riskPct, executions, autotrade, live, errors } = opts;

  const subject =
    buys.length || sells.length
      ? `📈 Signal Bot : ${buys.length} achat(s), ${sells.length} sortie(s)`
      : "📈 Signal Bot : aucun signal aujourd'hui";

  const row = (cells: string[]) =>
    `<tr>${cells.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid #243650;">${c}</td>`).join("")}</tr>`;
  const table = (head: string[], body: string) =>
    `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 18px;">
      <tr>${head.map((h) => `<th align="left" style="padding:6px 10px;color:#9FB2CC;border-bottom:1px solid #243650;">${h}</th>`).join("")}</tr>
      ${body}
    </table>`;

  let html = `<div style="font-family:Segoe UI,system-ui,sans-serif;background:#0B1220;color:#E6EDF7;padding:24px;border-radius:12px;max-width:640px;">
    <h2 style="margin:0 0 4px;">📈 Signal Bot — Actifs US</h2>
    <div style="color:#64789A;font-size:12px;margin-bottom:16px;">
      Clôture de Wall Street · capital de référence ${fmt$(capital)} $ · risque ${riskPct} % par trade
      ${autotrade ? ` · 🤖 trading auto <strong style="color:${live ? "#EF4444" : "#22C55E"}">${live ? "RÉEL" : "PAPER (fictif)"}</strong>` : ""}
    </div>`;

  if (buys.length) {
    html += `<h3 style="color:#22C55E;margin:12px 0 4px;">🟢 Signaux d'achat</h3>`;
    html += table(
      ["Actif", "Entrée", "Stop", "Quantité", "Sortie"],
      buys
        .map(({ symbol, r }) => {
          const plan = r.entryPlan!;
          const qty = positionSize(capital, riskPct, plan.entry, plan.stop);
          return row([
            `<strong>${symbol}</strong><br><span style="color:#64789A;font-size:11px;">${NAMES[symbol] ?? ""}</span>`,
            `≈ ${fmt$(plan.entry)} $`,
            `<span style="color:#EF4444;">${fmt$(plan.stop)} $</span>`,
            `${qty || "—"} action(s)`,
            "clôture &gt; MM5<br>(10 séances max)",
          ]);
        })
        .join("")
    );
  }

  if (sells.length) {
    html += `<h3 style="color:#EF4444;margin:12px 0 4px;">🔴 Signaux de sortie</h3>`;
    html += table(
      ["Actif", "Cours", "Raison"],
      sells
        .map(({ symbol, r }) =>
          row([
            `<strong>${symbol}</strong>`,
            `${fmt$(r.lastClose)} $`,
            r.exitReason ? EXIT_LABEL[r.exitReason] : "sortie",
          ])
        )
        .join("")
    );
  }

  if (holds.length) {
    html += `<h3 style="color:#F5B445;margin:12px 0 4px;">🟡 Positions à conserver</h3>`;
    html += table(
      ["Actif", "Entrée", "P&L", "Stop"],
      holds
        .map(({ symbol, r }) => {
          const o = r.open!;
          const pnl = (r.lastClose / o.entryPrice - 1) * 100;
          return row([
            `<strong>${symbol}</strong>`,
            `${fmt$(o.entryPrice)} $ (${o.daysHeld} séance(s))`,
            `<span style="color:${pnl >= 0 ? "#22C55E" : "#EF4444"};">${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} %</span>`,
            `<span style="color:#EF4444;">${fmt$(o.stop)} $</span>`,
          ]);
        })
        .join("")
    );
  }

  if (!buys.length && !sells.length && !holds.length) {
    html += `<p style="color:#9FB2CC;">Aucun signal ni position en cours. Rien à faire aujourd'hui. 😎</p>`;
  }

  if (executions.length) {
    html += `<h3 style="margin:12px 0 4px;">🤖 Ordres passés automatiquement</h3><ul style="font-size:13px;color:#9FB2CC;">`;
    html += executions
      .map((e) => `<li style="color:${e.ok ? "#22C55E" : "#EF4444"};">${e.line}</li>`)
      .join("");
    html += `</ul>`;
  }

  if (errors.length) {
    html += `<p style="color:#EF4444;font-size:12px;">Erreurs : ${errors.join(" · ")}</p>`;
  }

  const appUrl = process.env.APP_URL;
  html += `<p style="color:#64789A;font-size:11px;margin-top:18px;">
    ${appUrl ? `<a href="${appUrl}/trading.html" style="color:#4D9FFF;">Ouvrir le dashboard</a> · ` : ""}
    Outil d'aide à la décision — pas un conseil financier. Performances passées ≠ performances futures.
  </p></div>`;

  return { subject, html };
}

export async function sendEmail(subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Signal Bot <onboarding@resend.dev>",
      to: [process.env.ALERT_EMAIL],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
