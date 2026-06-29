/* ─── Configuration d'environnement centralisée & validée ──────────────────
 *
 * Point unique de lecture de process.env. Évite les `Number(process.env.X)`
 * éparpillés (qui renvoient NaN silencieusement) et documente chaque variable.
 *
 * Compatible runtime "edge" de Vercel : on lit uniquement process.env, pas de
 * dépendance Node. En local (Vite), ces variables ne sont pas nécessaires
 * (le proxy /api/market suffit pour le dashboard).
 */

import { DEFAULT_RISK, type RiskParams } from "../../src/trading/risk";

/** Lit une variable optionnelle (chaîne) ; renvoie undefined si vide. */
export function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Variable obligatoire : lève une erreur explicite si absente. */
export function required(name: string): string {
  const v = str(name);
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

/** Drapeau booléen : true uniquement si la valeur vaut exactement "true". */
export function flag(name: string): boolean {
  return process.env[name] === "true";
}

/** Nombre validé : renvoie le défaut si absent, NaN, ou hors bornes. */
export function num(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number } = {}
): number {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (opts.min !== undefined && parsed < opts.min) return fallback;
  if (opts.max !== undefined && parsed > opts.max) return fallback;
  return parsed;
}

/* ─── Snapshot de configuration (lecture seule, pas de secrets exposés) ──── */
export const env = {
  // Sécurité
  dashboardToken: () => str("DASHBOARD_TOKEN"),
  cronSecret: () => str("CRON_SECRET"),

  // Paramètres de trading (bornés pour éviter les valeurs absurdes)
  riskPct: () => num("RISK_PCT", 1, { min: 0.1, max: 5 }),
  defaultCapital: () => num("DEFAULT_CAPITAL", 10000, { min: 0 }),

  // Drapeaux d'activation
  autotrade: () => flag("AUTOTRADE"),
  alertAlways: () => flag("ALERT_ALWAYS"),

  appUrl: () => str("APP_URL"),
  // Plafond de slippage à l'achat (ordre limite = close × (1 + x%)). Défaut 0.5.
  entrySlippagePct: () => num("MAX_ENTRY_SLIPPAGE_PCT", 0.5, { min: 0, max: 5 }),
} as const;

/* ─── Paramètres du moteur de risque (Phase 1) ─────────────────────────────
 * Bornés pour éviter toute valeur dangereuse même en cas de faute de frappe. */
export function riskParams(): RiskParams {
  return {
    riskPct: num("RISK_PCT", DEFAULT_RISK.riskPct, { min: 0.1, max: 5 }),
    maxDailyLossPct: num("MAX_DAILY_LOSS_PCT", DEFAULT_RISK.maxDailyLossPct, { min: 0.5, max: 50 }),
    maxOpenPositions: num("MAX_OPEN_POSITIONS", DEFAULT_RISK.maxOpenPositions, { min: 1, max: 100 }),
    maxTradesPerDay: num("MAX_TRADES_PER_DAY", DEFAULT_RISK.maxTradesPerDay, { min: 1, max: 100 }),
    maxPositionPct: num("MAX_POSITION_PCT", DEFAULT_RISK.maxPositionPct, { min: 1, max: 100 }),
    maxGrossExposurePct: num("MAX_GROSS_EXPOSURE_PCT", DEFAULT_RISK.maxGrossExposurePct, { min: 1, max: 100 }),
    killSwitch: flag("KILL_SWITCH"),
  };
}

/** Indique au dashboard quelles intégrations sont configurées (sans secrets). */
export function integrationStatus() {
  return {
    alpaca: Boolean(str("ALPACA_KEY_ID") && str("ALPACA_SECRET_KEY")),
    live: flag("ALPACA_LIVE"),
    autotrade: flag("AUTOTRADE"),
    email: Boolean(str("RESEND_API_KEY") && str("ALERT_EMAIL")),
    authProtected: Boolean(str("DASHBOARD_TOKEN")),
  };
}
