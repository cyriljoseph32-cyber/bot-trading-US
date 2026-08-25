/* ─── Schéma unifié multi-actifs (pur, sans I/O) ───────────────────────────
 *
 * Tout instrument (action mondiale, paire FX, crypto) est normalisé vers ces
 * types uniques. Tous les horodatages sont en millisecondes epoch UTC.
 */

export type AssetClass = "equity" | "fx" | "crypto";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
/** Timeframes agrégés par défaut (bot temps réel 15m — comportement historique). */
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m"];
/** Timeframes de la stratégie SPC FX5 (signal H1, confirmations H4/D1). */
export const SPC_TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d"];
export const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export interface Instrument {
  /** Symbole côté fournisseur (ex : "AAPL", "EUR/USD", "7203" pour Toyota). */
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  /** Code MIC ou nom d'exchange ("NASDAQ", "LSE", "TSE", "FOREX"…). */
  exchange: string;
  /** Devise de cotation (ISO 4217). */
  currency: string;
  /** Pays de l'exchange (ISO 3166 alpha-2) — expositions du moteur de risque. */
  country: string;
  /** Secteur GICS simplifié — expositions du moteur de risque. */
  sector?: string;
  /** Région de l'univers ("us", "japan", "eurozone"…). */
  region: string;
}

/** Cotation temps réel normalisée. */
export interface Quote {
  symbol: string;
  assetClass: AssetClass;
  exchange: string;
  currency: string;
  bid: number | null;
  ask: number | null;
  last: number;
  /** Volume cumulé du jour (null pour FX spot). */
  volume: number | null;
  /** Horodatage de la cotation, ms epoch UTC. */
  ts: number;
  /** true si la donnée est trop vieille pour être exploitable. */
  stale: boolean;
  /**
   * true si le bid/ask est RECONSTITUÉ (dérivé d'un coût configuré) et non
   * observé sur le marché — cas des cotations dérivées de bougies H1. La
   * stratégie doit alors traiter le spread comme inconnu, pas comme mesuré.
   */
  estimated?: boolean;
}

/** Bougie OHLCV normalisée. */
export interface Bar {
  symbol: string;
  tf: Timeframe;
  /** Début de la bougie, ms epoch UTC, aligné sur le timeframe. */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Nombre de ticks agrégés (0 = bougie importée/historique). */
  ticks: number;
  /** Variation aberrante détectée (spike de prix) — à exclure des indicateurs. */
  outlier?: boolean;
  /** Bougie reconstituée après un trou de données. */
  gapBefore?: boolean;
}

/* ─── Signaux ────────────────────────────────────────────────────────────── */

/** Codes de raison explicites — aucun signal « boîte noire ». */
export type ReasonCode =
  | "trend_up" | "trend_down" | "trend_flat"
  | "momentum_strong" | "momentum_weak" | "momentum_oversold" | "momentum_overbought"
  | "volatility_normal" | "volatility_high" | "volatility_low"
  | "volume_surge" | "volume_normal" | "volume_thin"
  | "spread_ok" | "spread_wide"
  | "correlation_low" | "correlation_high"
  | "regime_risk_on" | "regime_risk_off" | "regime_neutral"
  | "data_insufficient" | "data_stale";

export type Side = "long" | "short" | "flat";

export interface ScoredSignal {
  symbol: string;
  assetClass: AssetClass;
  tf: Timeframe;
  side: Side;
  /** Score 0..100 (agrégat pondéré des filtres). */
  score: number;
  /** Confiance 0..1 (qualité/complétude des données + accord des filtres). */
  confidence: number;
  /** Justification complète, filtre par filtre. */
  reasons: ReasonCode[];
  /** Contributions détaillées pour le dashboard. */
  parts: Array<{ filter: string; value: number; points: number; max: number }>;
  /** Prix de référence au moment du calcul. */
  price: number;
  ts: number;
}

/* ─── Exécution ──────────────────────────────────────────────────────────── */

export interface OrderRequest {
  /** Clé d'idempotence : un même id ne peut produire qu'un seul ordre. */
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  /** Ordre au marché si absent. */
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface OrderResult {
  clientOrderId: string;
  status: "filled" | "rejected" | "duplicate";
  fillPrice?: number;
  qty?: number;
  reason?: string;
  ts: number;
}

export interface Position {
  symbol: string;
  assetClass: AssetClass;
  currency: string;
  country: string;
  sector?: string;
  qty: number; // >0 long, <0 short
  avgEntryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: number;
}

/** Photo de portefeuille exprimée en devise de base. */
export interface PortfolioSnapshot {
  baseCurrency: string;
  equity: number;
  cash: number;
  /** Equity à minuit UTC — base du P&L quotidien. */
  dayStartEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: Position[];
}
