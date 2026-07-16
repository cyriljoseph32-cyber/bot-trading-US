/* ─── Configuration d'environnement du bot (point unique de lecture) ───────
 *
 * Même philosophie que api/_lib/env.ts : lecture validée, défauts sûrs,
 * documentation de chaque variable. AUCUNE clé ne sort de ce processus —
 * le dashboard ne reçoit que des données déjà calculées.
 *
 * SÉCURITÉ : le trading réel exige LIVE_TRADING="true" ET un adaptateur de
 * courtier réel explicitement branché. Aucun adaptateur réel n'est fourni
 * dans ce dépôt : par construction, tout ordre part en paper trading.
 */

export function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function flag(name: string): boolean {
  return process.env[name] === "true";
}

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

export interface BotEnv {
  /** Clé API Twelve Data (WebSocket + REST). Sans elle : mode dégradé. */
  twelveDataApiKey: string | undefined;
  /** true = autorise un adaptateur de courtier RÉEL (jamais par défaut). */
  liveTrading: boolean;
  /** Devise de base du portefeuille papier. */
  baseCurrency: string;
  /** Port du serveur dashboard/API. */
  port: number;
  /** Crédits REST Twelve Data par minute (8 en offre gratuite). */
  tdRestRpm: number;
  /** Nombre max de symboles sur le WebSocket (8 en offre gratuite). */
  tdWsSymbolLimit: number;
  /** true = rafraîchit l'univers via l'API (coûte des crédits REST). */
  universeDynamic: boolean;
  /** Capital de départ du portefeuille papier. */
  paperCapital: number;
  /** Répertoire de persistance JSONL. */
  dataDir: string;
  /** Arrêt d'urgence au démarrage (modifiable ensuite via l'API). */
  killSwitch: boolean;
}

export function loadEnv(): BotEnv {
  return {
    twelveDataApiKey: str("TWELVEDATA_API_KEY"),
    liveTrading: flag("LIVE_TRADING"),
    baseCurrency: (str("BASE_CURRENCY") ?? "USD").toUpperCase(),
    port: num("BOT_PORT", 8787, { min: 1, max: 65535 }),
    tdRestRpm: num("TD_REST_RPM", 8, { min: 1, max: 1200 }),
    tdWsSymbolLimit: num("TD_WS_SYMBOL_LIMIT", 8, { min: 1, max: 5000 }),
    universeDynamic: flag("UNIVERSE_DYNAMIC"),
    paperCapital: num("PAPER_CAPITAL", 100_000, { min: 100 }),
    dataDir: str("BOT_DATA_DIR") ?? "data",
    killSwitch: flag("KILL_SWITCH"),
  };
}
