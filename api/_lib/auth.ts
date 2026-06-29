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
  reason?: "missing" | "invalid" | "unconfigured";
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

export function checkDashboardAuth(
  req: Request,
  opts: { failClosed?: boolean } = {}
): AuthResult {
  const token = env.dashboardToken();
  if (!token) {
    // Fix #6 : pour les endpoints sensibles (compte, assistant qui consomme la
    // clé Anthropic), on REFUSE tant que DASHBOARD_TOKEN n'est pas défini —
    // au lieu d'exposer publiquement.
    return opts.failClosed ? { ok: false, reason: "unconfigured" } : { ok: true };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: "missing" };

  return safeEqual(match[1], token)
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}

export function unauthorizedResponse(
  reason: "missing" | "invalid" | "unconfigured"
): Response {
  const message =
    reason === "missing"
      ? "Token requis. Entrez le token du dashboard."
      : reason === "invalid"
        ? "Token invalide."
        : "Accès désactivé : définissez DASHBOARD_TOKEN dans les variables d'environnement pour activer cet endpoint.";
  return new Response(
    JSON.stringify({ error: "unauthorized", reason, message }),
    {
      status: reason === "unconfigured" ? 503 : 401,
      headers: { "content-type": "application/json" },
    }
  );
}
