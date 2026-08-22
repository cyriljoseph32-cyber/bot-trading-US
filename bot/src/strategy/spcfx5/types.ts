/* ─── Types SPC FX5 (schéma des actifs, des signaux et des rejets) ─────────
 *
 * Aucune logique ici : uniquement le contrat de données partagé entre la
 * config d'univers, les filtres, le scoring, le classement et le runner.
 */

import type { AssetClass, Instrument, Side } from "../../types";
import type { Direction, SpcCategory } from "./params";

/* ─── Univers ────────────────────────────────────────────────────────────── */

/**
 * Un actif de la watchlist. `std` est le symbole standard (celui dont on parle
 * entre humains), `provider` le symbole tel que le fournisseur/courtier
 * l'attend — le mapping est explicite, on ne devine JAMAIS un ticker.
 */
export interface SpcAsset {
  /** Symbole standard, ex. "EURUSD", "XAUUSD", "NAS100". */
  std: string;
  /** Symbole côté fournisseur/courtier, ex. "EUR/USD", "XAU/USD", "QQQ". */
  provider: string;
  name?: string;
  category: SpcCategory;
  assetClass: AssetClass;
  exchange: string;
  currency: string;
  country: string;
  sector?: string;
  /** false = ignoré (non disponible chez le courtier, illiquide, en test…). */
  enabled: boolean;
  /** Commentaire libre — sert notamment aux « [À VÉRIFIER CHEZ LE COURTIER] ». */
  note?: string;
  /** Coût aller-retour estimé en points de base (spread + commission). */
  costBps?: number;
  /** Taille de tick, pour le buffer de breakout exprimé en ticks. */
  tickSize?: number;
  /**
   * Groupes de corrélation, avec le signe du pari : "usd:+1" = être long cet
   * actif revient à être long USD ; "usd:-1" = long cet actif = short USD.
   */
  groups: string[];
}

/** Motif pour lequel un actif de la config n'est pas suivi. */
export type SpcSkipReason =
  | "disabled"
  | "duplicate_symbol"
  | "unknown_category"
  | "over_symbol_cap";

export interface SpcUniverseEntry {
  asset: SpcAsset;
  instrument: Instrument;
}

export interface SpcUniverseResult {
  selected: SpcUniverseEntry[];
  skipped: Array<{ std: string; reason: SpcSkipReason }>;
}

/* ─── Signaux ────────────────────────────────────────────────────────────── */

/** Codes de rejet — un signal refusé dit toujours POURQUOI. */
export type SpcRejectCode =
  | "data_insufficient"
  | "data_stale"
  | "indicators_unavailable"
  | "sma_not_aligned"
  | "sma_slope_weak"
  | "di_not_aligned"
  | "di_spread_weak"
  | "adx_below_threshold"
  | "utbot_no_flip"
  | "utbot_flip_stale"
  | "mtf_h4_conflict"
  | "mtf_d1_conflict"
  | "breakout_not_confirmed"
  | "volatility_too_low"
  | "volatility_too_high"
  | "cost_too_high"
  | "volume_thin"
  | "session_closed"
  | "news_blackout"
  | "chop_too_close_to_sma"
  | "stop_too_tight"
  | "stop_too_wide"
  | "stop_invalid"
  | "score_below_min";

/** Note informative n'empêchant pas le signal (ex. volume FX indisponible). */
export type SpcNoteCode = "volume_unavailable" | "news_feed_absent" | "spread_unknown";

/** Contribution d'un composant au score, exposée telle quelle au dashboard. */
export interface SpcScorePart {
  component: keyof import("./params").ScoreWeights;
  /** Valeur mesurée (ADX, pente %, ATR%…). */
  value: number;
  points: number;
  max: number;
  detail: string;
}

export interface SpcSignal {
  symbol: string;
  std: string;
  assetClass: AssetClass;
  category: SpcCategory;
  tf: "1h";
  side: Side;
  /** Score 0..100 (somme des composants). */
  score: number;
  /** Détail composant par composant — jamais de score « boîte noire ». */
  parts: SpcScorePart[];
  reasons: string[];
  rejects: SpcRejectCode[];
  notes: SpcNoteCode[];
  /** Prix de référence = clôture de la bougie H1 évaluée. */
  price: number;
  /** Stop proposé (prix absolu). */
  stopLoss: number | null;
  /** Take-profit proposé (prix absolu). */
  takeProfit: number | null;
  /** Risque par unité (|entrée − stop|), devise de cotation. */
  riskPerUnit: number | null;
  /** RR brut et RR net de coûts. */
  rrGross: number | null;
  rrNet: number | null;
  /** ATR(14) de la bougie évaluée. */
  atr: number | null;
  /** Horodatage de CLÔTURE de la bougie H1 évaluée. */
  ts: number;
  /** true si le setup est complet et éligible (score ≥ minScore, 0 rejet). */
  eligible: boolean;
}

/** Direction du pari porté par un signal au sein d'un groupe de corrélation. */
export interface GroupBet {
  group: string;
  direction: Direction;
}
