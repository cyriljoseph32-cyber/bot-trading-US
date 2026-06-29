/* ─── Authentification du dashboard (Phase 0) ──────────────────────────────
 *
 * Mécanisme volontairement simple pour un outil mono-utilisateur : un token
 * partagé (DASHBOARD_TOKEN) envoyé en en-tête `Authorization: Bearer <token>`.
 *
 *  • Tant que DASHBOARD_TOKEN n'est PAS défini → endpoint ouvert (comportement
 *    historique, pour ne pas se verrouiller dehors avant d'avoir configuré).
 *  • Dès que DASHBOARD_TOKEN est défini → token valide obligatoire, sinon 401.
 *
 * Remplacé par Supabase Auth (vrais comptes utilisateurs) à la phase DB.
 * Comparaison à temps constant pour limiter les attaques par timing.
 */

import { env } from "./env";

export interface AuthResult {
  ok: boolean;
  reason?: "missing" | "invalid";
}

/** Comparaison à temps constant (la longueur peut différer pour un token aléatoire). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function checkDashboardAuth(req: Request): AuthResult {
  const token = env.dashboardToken();
  if (!token) return { ok: true }; // non protégé tant que la variable est absente

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: "missing" };

  return safeEqual(match[1], token)
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}

export function unauthorizedResponse(reason: "missing" | "invalid"): Response {
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      reason,
      message:
        reason === "missing"
          ? "Token requis. Entrez le token du dashboard."
          : "Token invalide.",
    }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}
