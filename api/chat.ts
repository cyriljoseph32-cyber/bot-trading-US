export const config = { runtime: "edge" };

import { checkDashboardAuth, unauthorizedResponse } from "./_lib/auth";
import { fetchLatestSignals, fetchRecentOrders, fetchRecentRuns } from "./_lib/db";
import { str } from "./_lib/env";

/* ─── Assistant conversationnel du bot (Phase 5) ───────────────────────────
 *
 * Répond aux questions de l'opérateur ("Pourquoi ce trade ?", "Meilleurs
 * setups aujourd'hui ?", "Explique cette perte") en s'appuyant sur le JOURNAL
 * réel (Supabase) injecté en contexte — pas d'invention.
 *
 * Protégé par DASHBOARD_TOKEN. Nécessite ANTHROPIC_API_KEY.
 */

const SYSTEM = `Tu es l'assistant de "Signal Bot US", un bot de trading sur actions/ETF américains.

Stratégie : retour à la moyenne RSI-2 (entrée si clôture > MM200 ET RSI(2) < 10 ; sortie si clôture > MM5, ou stop à entrée − 2,5×ATR, ou 10 séances max). Long uniquement.

Chaque signal reçoit un SCORE 0-100 (technique + historique NET du setup (frais et slippage inclus) + sentiment) : 90+ très forte opportunité, 70-89 intéressante, 50-69 surveillance, <50 ignorer.

Gestion du risque : risque limité par trade, perte max quotidienne, nombre max de positions et de trades/jour, stop attaché à chaque achat. Le bot peut être en paper trading (argent fictif) ou réel.

Règles de réponse :
- Réponds dans la langue de l'utilisateur, de façon claire, concise et concrète.
- Appuie-toi UNIQUEMENT sur les données de contexte fournies (signaux, ordres, runs récents). Si l'info manque, dis-le simplement.
- Explique tes raisonnements de manière compréhensible (pas de jargon inutile).
- Tu n'es PAS un conseiller financier : pas de promesse de gain, rappelle que les performances passées ne préjugent pas du futur si on te pousse à garantir des résultats.`;

function summarizeContext(
  signals: Record<string, unknown>[],
  orders: Record<string, unknown>[],
  runs: Record<string, unknown>[]
): string {
  const topSignals = signals
    .slice(0, 25)
    .map(
      (s) =>
        `${s.symbol}: action=${s.action} score=${s.score ?? "?"} tendance=${s.trend ?? "?"} ` +
        `RSI2=${fmt(s.rsi2)} entrée=${fmt(s.entry)} stop=${fmt(s.stop)} winRate=${fmt(s.win_rate)}`
    )
    .join("\n");
  const ords = orders
    .slice(0, 15)
    .map(
      (o) =>
        `${o.created_at ?? ""} ${o.side} ${o.symbol} qty=${o.qty ?? "?"} statut=${o.status ?? "?"}` +
        (o.error ? ` erreur=${o.error}` : "")
    )
    .join("\n");
  const lastRun = runs[0]
    ? `Dernier run: ${runs[0].created_at} analysés=${runs[0].analysed} achats=${runs[0].buys} ventes=${runs[0].sells} (live=${runs[0].live})`
    : "Aucun run enregistré.";
  return `=== DERNIERS SIGNAUX ===\n${topSignals || "aucun"}\n\n=== ORDRES RÉCENTS ===\n${ords || "aucun"}\n\n=== RUNS ===\n${lastRun}`;
}

function fmt(v: unknown): string {
  if (v == null) return "?";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}


/* ─── Garde-fous d'entrée & limitation de débit (fix #7) ───────────────────
 * Best-effort : l'état est par-instance edge (pas de garantie multi-instance),
 * mais coupe les abus évidents et protège la clé Anthropic. */
const MAX_MSGS = 20;
const MAX_MSG_CHARS = 8000;
const MAX_TOTAL_CHARS = 24000;
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
const rlBucket = new Map<string, { count: number; reset: number }>();

function rateLimited(req: Request): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const b = rlBucket.get(ip);
  if (!b || now > b.reset) {
    rlBucket.set(ip, { count: 1, reset: now + RL_WINDOW_MS });
    return false;
  }
  b.count++;
  return b.count > RL_MAX;
}

export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (rateLimited(req)) {
    return new Response(JSON.stringify({ error: "rate_limited", message: "Trop de requêtes, réessayez dans une minute." }), {
      status: 429, headers: { "content-type": "application/json" },
    });
  }

  const auth = checkDashboardAuth(req, { failClosed: true });
  if (!auth.ok) return unauthorizedResponse(auth.reason!);

  const apiKey = str("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY non configuré" }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  try {
    const { messages } = await req.json();

    // Bornage des entrées (fix #7) : on tronque l'historique et on rejette les
    // charges anormales (protège coûts/tokens et limite les abus).
    const msgList: { role: string; content: string }[] = Array.isArray(messages) ? messages : [];
    const trimmed = msgList.slice(-MAX_MSGS);
    let total = 0;
    for (const m of trimmed) {
      const c = typeof m?.content === "string" ? m.content : "";
      if (c.length > MAX_MSG_CHARS) {
        return new Response(JSON.stringify({ error: "message_too_long", message: `Message trop long (max ${MAX_MSG_CHARS} caractères).` }), {
          status: 413, headers: { "content-type": "application/json" },
        });
      }
      total += c.length;
    }
    if (total > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({ error: "payload_too_large", message: "Conversation trop volumineuse." }), {
        status: 413, headers: { "content-type": "application/json" },
      });
    }

    // Contexte temps réel depuis le journal (best-effort).
    const [signals, orders, runs] = await Promise.all([
      fetchLatestSignals(40),
      fetchRecentOrders(20),
      fetchRecentRuns(5),
    ]);
    const context = summarizeContext(signals, orders, runs);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: `${SYSTEM}\n\n--- CONTEXTE ACTUEL DU BOT ---\n${context}`,
        messages: trimmed
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur serveur" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
