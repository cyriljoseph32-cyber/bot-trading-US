/* ─── Sessions de marché (pur, tout en UTC) ────────────────────────────────
 *
 * Détermine si un instrument est censé coter à un instant donné :
 *   • actions : horaires d'ouverture de leur exchange, exprimés en UTC,
 *     jours ouvrés seulement (les jours fériés locaux ne sont pas modélisés :
 *     on tolère l'absence de données via le seuil de staleness, pas d'ordre
 *     ne part sur données stales de toute façon) ;
 *   • FX : 24h/24 du dimanche 21h00 UTC au vendredi 22h00 UTC ;
 *   • crypto : 24h/24, 7j/7.
 *
 * NB : les horaires UTC des bourses varient avec l'heure d'été locale ; on
 * prend la fenêtre la plus LARGE des deux régimes (été/hiver) — préférable
 * pour un flag "marché ouvert" qui sert à interpréter l'absence de ticks.
 */

import type { AssetClass } from "./types";

interface SessionWindow {
  /** Minutes UTC depuis minuit — début (inclus) et fin (exclu). */
  openMin: number;
  closeMin: number;
}

/** Fenêtres UTC élargies (union été+hiver) par exchange. */
const EXCHANGE_SESSIONS: Record<string, SessionWindow[]> = {
  // Amériques
  NASDAQ: [{ openMin: 13 * 60 + 30, closeMin: 21 * 60 }],
  NYSE: [{ openMin: 13 * 60 + 30, closeMin: 21 * 60 }],
  TSX: [{ openMin: 13 * 60 + 30, closeMin: 21 * 60 }],
  BMV: [{ openMin: 13 * 60 + 30, closeMin: 21 * 60 }],
  BVMF: [{ openMin: 13 * 60, closeMin: 21 * 60 }], // B3 São Paulo
  // Europe / Afrique
  LSE: [{ openMin: 8 * 60, closeMin: 16 * 60 + 30 }],
  XETR: [{ openMin: 7 * 60, closeMin: 16 * 60 + 30 }],
  Euronext: [{ openMin: 7 * 60, closeMin: 16 * 60 + 30 }],
  SIX: [{ openMin: 7 * 60, closeMin: 16 * 60 + 30 }],
  OMX: [{ openMin: 7 * 60, closeMin: 16 * 60 + 30 }],
  JSE: [{ openMin: 7 * 60, closeMin: 15 * 60 }],
  // Asie / Océanie (Tokyo a une pause déjeuner 02:30–03:30 UTC)
  TSE: [
    { openMin: 0, closeMin: 2 * 60 + 30 },
    { openMin: 3 * 60 + 30, closeMin: 6 * 60 },
  ],
  HKEX: [
    { openMin: 1 * 60 + 30, closeMin: 4 * 60 },
    { openMin: 5 * 60, closeMin: 8 * 60 },
  ],
  SSE: [
    { openMin: 1 * 60 + 30, closeMin: 3 * 60 + 30 },
    { openMin: 5 * 60, closeMin: 7 * 60 },
  ],
  NSE: [{ openMin: 3 * 60 + 45, closeMin: 10 * 60 }],
  KRX: [{ openMin: 0, closeMin: 6 * 60 + 30 }],
  ASX: [{ openMin: 23 * 60, closeMin: 24 * 60 }, { openMin: 0, closeMin: 6 * 60 }],
  SGX: [{ openMin: 1 * 60, closeMin: 9 * 60 }],
};

function utcMinutes(ts: number): { day: number; min: number } {
  const d = new Date(ts);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** FX spot : ouvert du dimanche 21h00 UTC au vendredi 22h00 UTC. */
export function isFxOpen(ts: number): boolean {
  const { day, min } = utcMinutes(ts);
  if (day === 6) return false; // samedi
  if (day === 0) return min >= 21 * 60; // dimanche soir
  if (day === 5) return min < 22 * 60; // vendredi jusqu'à 22h
  return true;
}

/** Session actions : jours ouvrés + fenêtre de l'exchange. */
export function isExchangeOpen(exchange: string, ts: number): boolean {
  const { day, min } = utcMinutes(ts);
  if (day === 0 || day === 6) return false;
  const windows = EXCHANGE_SESSIONS[exchange];
  if (!windows) return day >= 1 && day <= 5; // exchange inconnu : jours ouvrés
  return windows.some((w) => min >= w.openMin && min < w.closeMin);
}

export function isMarketOpen(assetClass: AssetClass, exchange: string, ts: number): boolean {
  if (assetClass === "crypto") return true;
  if (assetClass === "fx") return isFxOpen(ts);
  return isExchangeOpen(exchange, ts);
}

/** Seuil de staleness (ms) : dépend de la classe d'actif ET de la session. */
export function staleThresholdMs(assetClass: AssetClass, exchange: string, ts: number): number {
  if (!isMarketOpen(assetClass, exchange, ts)) return Number.POSITIVE_INFINITY; // marché fermé : pas stale
  if (assetClass === "fx" || assetClass === "crypto") return 60_000;
  return 120_000; // actions : les titres peu actifs peuvent rester 1-2 min sans tick
}

/** true si la cotation est trop vieille pour être exploitable. */
export function isStale(
  assetClass: AssetClass,
  exchange: string,
  quoteTs: number,
  now: number
): boolean {
  return now - quoteTs > staleThresholdMs(assetClass, exchange, now);
}
