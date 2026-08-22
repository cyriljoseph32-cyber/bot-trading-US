/* ─── Paramètres SPC FX5 Multi-Asset 100 ───────────────────────────────────
 *
 * Un seul endroit pour tout ce qui se règle. CHAQUE filtre est activable ou
 * désactivable (`enabled`), et chaque seuil a un défaut documenté. Rien n'est
 * codé en dur ailleurs dans la stratégie.
 *
 * ⚠ Les défauts sont des points de départ raisonnables, PAS des valeurs
 * optimisées ni une promesse de performance. À valider en backtest sur vos
 * propres données avant toute utilisation.
 */

export type Direction = "long" | "short";

/** Catégories d'actifs de la watchlist (seuils de volatilité et coûts distincts). */
export type SpcCategory =
  | "fx_major"
  | "fx_minor"
  | "fx_exotic"
  | "index"
  | "metal"
  | "energy"
  | "agriculture"
  | "equity"
  | "etf"
  | "crypto";

export interface TrendParams {
  /** Période de la moyenne mobile de tendance macro. */
  smaPeriod: number;
  /** Nombre de barres sur lesquelles on mesure la pente de la SMA. */
  slopeLookback: number;
  /** Pente minimale (%) pour considérer la SMA orientée. */
  minSlopePct: number;
}

export interface MomentumParams {
  /** Période ADX / DI. */
  adxPeriod: number;
  /** Seuil minimal d'ADX (sous ce niveau : marché sans direction). */
  minAdx: number;
  /** ADX à partir duquel la force est considérée maximale (barème du score). */
  strongAdx: number;
  /** Écart relatif minimal entre DI+ et DI- : |DI+ − DI-| / (DI+ + DI-). */
  minDiSpread: number;
}

export interface UtBotParams {
  keyValue: number;
  atrPeriod: number;
  /** Nb max de barres écoulées depuis le flip pour que le signal reste valide. */
  maxBarsSinceFlip: number;
}

export interface VolatilityFilterParams {
  enabled: boolean;
  /** Période de l'ATR de référence. */
  atrPeriod: number;
  /** Bandes ATR% par catégorie (défaut, surchargées par la config d'univers). */
  bands: Record<SpcCategory, { minAtrPct: number; maxAtrPct: number }>;
}

export interface CostFilterParams {
  enabled: boolean;
  /** Coût aller-retour par défaut, en points de base, si l'actif n'en définit pas. */
  defaultCostBps: number;
  /** Slippage estimé additionnel, en points de base. */
  slippageBps: number;
  /** RR minimal APRÈS coûts pour qu'un signal soit éligible. */
  minRrNet: number;
}

export interface VolumeFilterParams {
  enabled: boolean;
  /** Période de la moyenne de volume. */
  lookback: number;
  /** Ratio minimal volume / moyenne. */
  minRatio: number;
}

/** Fenêtre de session, en minutes UTC depuis minuit. */
export interface SessionWindow {
  name: string;
  openMin: number;
  closeMin: number;
}

export interface SessionFilterParams {
  enabled: boolean;
  /** Sessions autorisées pour le FX (défaut : Londres + New York). */
  fx: SessionWindow[];
  /** Heures creuses exclues pour la crypto (vide = 24/7 intégral). */
  cryptoExcluded: SessionWindow[];
  /**
   * true = pour les actions/indices/matières premières, exiger la séance
   * principale de leur marché (via bot/src/sessions.ts).
   */
  requireExchangeSession: boolean;
}

export interface NewsFilterParams {
  enabled: boolean;
  /** Minutes de blocage AVANT une annonce à fort impact. */
  minutesBefore: number;
  /** Minutes de blocage APRÈS une annonce à fort impact. */
  minutesAfter: number;
  /**
   * false (défaut) = les positions ouvertes ne sont JAMAIS fermées par le
   * filtre news ; seules les nouvelles entrées sont bloquées.
   */
  closePositionsOnNews: boolean;
}

export interface AntiChopParams {
  enabled: boolean;
  /**
   * Distance minimale entre le prix et la SMA de tendance, en multiples d'ATR.
   * 0 = désactivé. Évite d'entrer collé à la moyenne, là où le prix oscille.
   */
  minDistanceToSmaAtr: number;
}

export interface MtfParams {
  /** Confirmation H4 de la tendance dominante. */
  h4Enabled: boolean;
  /** Confirmation D1 (filtre macro). */
  d1Enabled: boolean;
  /** Période de SMA utilisée sur les timeframes supérieures. */
  smaPeriod: number;
}

export interface BreakoutParams {
  enabled: boolean;
  /** Nombre de bougies du range de référence (canal de Donchian). */
  lookback: number;
  /** Buffer au-delà du niveau, en multiples d'ATR. */
  bufferAtrMult: number;
  /** Buffer minimal absolu, en ticks (0 = ignoré). */
  bufferTicks: number;
}

export interface StopParams {
  /** Distance de stop de base, en multiples d'ATR. */
  atrMult: number;
  /** Référence technique combinée à l'ATR. */
  technical: "swing" | "utbot" | "none";
  /** Profondeur de recherche des swings. */
  swingLookback: number;
  /** Stop minimal accepté, en multiples d'ATR (sous ce seuil : rejet). */
  minAtrMult: number;
  /** Stop maximal accepté, en multiples d'ATR (au-dessus : rejet). */
  maxAtrMult: number;
  /** Ratio take-profit / risque. */
  takeProfitR: number;
  /** Déplacement du stop au point mort à +1R. */
  breakEvenAtR: number | null;
  /** Activation du trailing stop à partir de ce multiple de R (null = off). */
  trailAfterR: number | null;
  /** Distance du trailing stop, en multiples d'ATR. */
  trailAtrMult: number;
}

export interface ScoreWeights {
  smaAlignment: number;
  smaSlope: number;
  adxStrength: number;
  diSpread: number;
  utBotQuality: number;
  volatility: number;
  execution: number;
}

export interface SpcParams {
  trend: TrendParams;
  momentum: MomentumParams;
  utBot: UtBotParams;
  volatility: VolatilityFilterParams;
  cost: CostFilterParams;
  volume: VolumeFilterParams;
  session: SessionFilterParams;
  news: NewsFilterParams;
  antiChop: AntiChopParams;
  mtf: MtfParams;
  breakout: BreakoutParams;
  stop: StopParams;
  weights: ScoreWeights;
  /** Score minimal (sur 100) pour qu'un setup soit éligible. */
  minScore: number;
  /** Nb minimal de bougies H1 closes avant d'évaluer un symbole. */
  minBars: number;
}

/** Bandes de volatilité par défaut — ATR(14) en % du prix, sur H1. */
const DEFAULT_VOL_BANDS: VolatilityFilterParams["bands"] = {
  fx_major: { minAtrPct: 0.03, maxAtrPct: 0.6 },
  fx_minor: { minAtrPct: 0.04, maxAtrPct: 0.8 },
  fx_exotic: { minAtrPct: 0.05, maxAtrPct: 1.5 },
  index: { minAtrPct: 0.05, maxAtrPct: 1.2 },
  metal: { minAtrPct: 0.05, maxAtrPct: 1.5 },
  energy: { minAtrPct: 0.1, maxAtrPct: 2.5 },
  agriculture: { minAtrPct: 0.08, maxAtrPct: 2 },
  equity: { minAtrPct: 0.08, maxAtrPct: 2.5 },
  etf: { minAtrPct: 0.05, maxAtrPct: 1.5 },
  crypto: { minAtrPct: 0.15, maxAtrPct: 4 },
};

/**
 * Pondération du score (total = 100). Modifier les poids change l'ordre du
 * classement : à faire consciemment, et à revalider en backtest.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  smaAlignment: 20,
  smaSlope: 15,
  adxStrength: 20,
  diSpread: 10,
  utBotQuality: 15,
  volatility: 10,
  execution: 10,
};

export const DEFAULT_SPC_PARAMS: SpcParams = {
  trend: { smaPeriod: 200, slopeLookback: 20, minSlopePct: 0.02 },
  momentum: { adxPeriod: 14, minAdx: 20, strongAdx: 40, minDiSpread: 0.1 },
  utBot: { keyValue: 1, atrPeriod: 10, maxBarsSinceFlip: 0 },
  volatility: { enabled: true, atrPeriod: 14, bands: DEFAULT_VOL_BANDS },
  cost: { enabled: true, defaultCostBps: 3, slippageBps: 2, minRrNet: 1.5 },
  volume: { enabled: true, lookback: 20, minRatio: 0.3 },
  session: {
    enabled: true,
    // Londres 07:00–16:00 UTC, New York 12:00–21:00 UTC (fenêtres élargies).
    fx: [
      { name: "london", openMin: 7 * 60, closeMin: 16 * 60 },
      { name: "newyork", openMin: 12 * 60, closeMin: 21 * 60 },
    ],
    cryptoExcluded: [],
    requireExchangeSession: true,
  },
  news: { enabled: true, minutesBefore: 30, minutesAfter: 30, closePositionsOnNews: false },
  antiChop: { enabled: true, minDistanceToSmaAtr: 0.5 },
  mtf: { h4Enabled: true, d1Enabled: false, smaPeriod: 50 },
  breakout: { enabled: true, lookback: 20, bufferAtrMult: 0.1, bufferTicks: 0 },
  stop: {
    atrMult: 2,
    technical: "swing",
    swingLookback: 3,
    minAtrMult: 0.8,
    maxAtrMult: 4,
    takeProfitR: 2,
    breakEvenAtR: 1,
    trailAfterR: 1.5,
    trailAtrMult: 2,
  },
  weights: DEFAULT_WEIGHTS,
  minScore: 70,
  minBars: 220, // SMA 200 + marge pour ADX et pente
};

/** Fusion superficielle par section — pratique pour surcharger depuis un JSON. */
export function mergeParams(base: SpcParams, override: Partial<SpcParams>): SpcParams {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof current === "object" &&
      current !== null
    ) {
      out[key] = { ...(current as object), ...(value as object) };
    } else {
      out[key] = value;
    }
  }
  return out as unknown as SpcParams;
}
