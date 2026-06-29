/* ─── Token du dashboard (Phase 0) ─────────────────────────────────────────
 * Stocke le token dans localStorage et l'ajoute aux appels API protégés.
 * Sera remplacé par une vraie session Supabase à la phase base de données.
 */

const KEY = "bot_dashboard_token";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(t: string): void {
  try {
    localStorage.setItem(KEY, t.trim());
  } catch {
    /* localStorage indisponible : on ignore */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** fetch avec le header Authorization si un token est présent. */
export function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
