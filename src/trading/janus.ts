/* ─── JANUS — méta-pondération de cohortes (pur, testable) ─────────────────
 *
 * Portage TypeScript de la couche JANUS d'ATLAS (à l'origine en Python).
 *
 * JANUS se place au-dessus de plusieurs cohortes d'agents (p. ex. une cohorte
 * entraînée sur 18 mois et une sur 10 ans) et pondère dynamiquement leurs
 * recommandations selon leur précision récente. Le différentiel de poids entre
 * cohortes fait émerger un détecteur de régime de marché.
 *
 * Contrairement à la version Python (qui lisait/écrivait des fichiers JSON),
 * ce module est PUR : on lui passe les données (outcomes, recommandations) en
 * argument. La persistance est laissée à la couche db/api de l'application.
 *
 * Pipeline :
 *   scoreRecommendation()  → note une reco contre le rendement réalisé
 *   calculateCohortMetrics → hit-rate + Sharpe sur la fenêtre glissante
 *   updateWeights()        → softmax contraint sur (hit-rate, Sharpe)
 *   regimeSignal()         → NOVEL / HISTORICAL / MIXED selon l'écart de poids
 *   blendRecommendations() → fusion pondérée, gère les désaccords (contested)
 */

export type Direction = "LONG" | "SHORT";

export interface Recommendation {
  ticker: string;
  /** LONG (défaut) ou SHORT — insensible à la casse en entrée. */
  direction?: string;
  /** Conviction 0..100 (défaut 50). */
  conviction?: number;
  /** Agents contributeurs (traçabilité). */
  agents?: string[];
}

/** Bloc de recommandations d'une cohorte pour une journée. */
export interface CohortRecommendations {
  recommendations: Recommendation[];
}

/** Une reco notée contre le rendement réalisé le lendemain. */
export interface ScoredOutcome {
  cohort: string;
  /** Date ISO (YYYY-MM-DD) — sert au filtrage sur la fenêtre glissante. */
  date: string;
  ticker?: string;
  direction?: Direction;
  conviction?: number;
  actualReturn?: number;
  isHit?: boolean;
  weightedReturn?: number;
}

export interface CohortMetrics {
  hitRate: number; // 0..1
  sharpe: number; // Sharpe annualisé des rendements pondérés
}

export interface CohortBreakdownEntry {
  conviction?: number;
  direction?: string;
  weight: number;
}

export interface BlendedRecommendation {
  ticker: string;
  direction: Direction;
  conviction: number; // 0.. , arrondi à 0.1
  contested: boolean; // cohortes en désaccord sur la direction
  agents: string[];
  cohortBreakdown: Record<string, CohortBreakdownEntry>;
}

export interface BlendResult {
  blendedRecommendations: BlendedRecommendation[];
  contestedTickers: string[];
}

export type Regime = "NOVEL_REGIME" | "HISTORICAL_REGIME" | "MIXED";

export interface JanusOutput {
  date: string;
  cohortWeights: Record<string, number>;
  regime: Regime;
  blendedRecommendations: BlendedRecommendation[];
  contestedTickers: string[];
  cohortAccuracy30d: Record<string, CohortMetrics>;
  generatedAt: string;
}

/** Résumé conservé dans l'historique (sans les recos complètes). */
export interface JanusHistoryEntry {
  date: string;
  cohortWeights: Record<string, number>;
  regime: Regime;
  cohortAccuracy30d: Record<string, CohortMetrics>;
  numRecommendations: number;
  numContested: number;
}

const TRADING_DAYS = 252;

export class Janus {
  /** Aucune cohorte ne descend sous 20 % d'influence. */
  static readonly MIN_WEIGHT = 0.2;
  /** Aucune cohorte ne dépasse 80 % d'influence. */
  static readonly MAX_WEIGHT = 0.8;
  /** Fenêtre glissante (jours) pour la précision. */
  static readonly ROLLING_WINDOW = 30;
  /** Seuil d'écart de poids pour signaler un régime. */
  static readonly REGIME_THRESHOLD = 0.15;

  readonly cohorts: string[];
  cohortWeights: Record<string, number> = {};
  cohortAccuracy: Record<string, CohortMetrics> = {};

  constructor(cohorts: string[] = ["18month", "10year"]) {
    this.cohorts = cohorts.length > 0 ? cohorts : ["18month", "10year"];
    this.initializeWeights();
  }

  /** Poids égaux au départ, précision neutre. */
  private initializeWeights(): void {
    const equal = 1 / this.cohorts.length;
    for (const cohort of this.cohorts) {
      this.cohortWeights[cohort] = equal;
      this.cohortAccuracy[cohort] = { hitRate: 0.5, sharpe: 0 };
    }
  }

  /** Note une reco contre le rendement réalisé (décimal, 0.02 = +2 %). */
  scoreRecommendation(rec: Recommendation, actualReturn: number): ScoredOutcome {
    const direction = normalizeDirection(rec.direction);
    const conviction = (rec.conviction ?? 50) / 100; // 0..1

    const isHit = direction === "LONG" ? actualReturn > 0 : actualReturn < 0;
    // SHORT : on profite de la baisse → on inverse le signe.
    const weightedReturn =
      direction === "LONG" ? conviction * actualReturn : conviction * -actualReturn;

    return {
      cohort: "",
      date: "",
      ticker: rec.ticker,
      direction,
      conviction: rec.conviction,
      actualReturn,
      isHit,
      weightedReturn,
    };
  }

  /** hit-rate + Sharpe d'une cohorte sur la fenêtre glissante. */
  calculateCohortMetrics(cohort: string, outcomes: ScoredOutcome[]): CohortMetrics {
    const cutoff = isoDaysAgo(Janus.ROLLING_WINDOW);
    const cohortOutcomes = outcomes.filter(
      (o) => o.cohort === cohort && (o.date ?? "") >= cutoff
    );

    if (cohortOutcomes.length === 0) {
      return { hitRate: 0.5, sharpe: 0 };
    }

    const hits = cohortOutcomes.filter((o) => o.isHit).length;
    const hitRate = hits / cohortOutcomes.length;

    const weightedReturns = cohortOutcomes.map((o) => o.weightedReturn ?? 0);

    let sharpe = 0;
    if (weightedReturns.length >= 2) {
      const mean =
        weightedReturns.reduce((s, r) => s + r, 0) / weightedReturns.length;
      const variance =
        weightedReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
        (weightedReturns.length - 1);
      const stdDev = variance > 0 ? Math.sqrt(variance) : 0.0001;
      sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(TRADING_DAYS) : 0;
    }

    return { hitRate, sharpe };
  }

  /** Softmax des scores bruts, avec plancher/plafond puis renormalisation. */
  private softmaxWithConstraints(scores: Record<string, number>): Record<string, number> {
    const keys = Object.keys(scores);
    if (keys.length === 0) return {};

    const maxScore = Math.max(...keys.map((k) => scores[k]));
    const expScores: Record<string, number> = {};
    for (const k of keys) expScores[k] = Math.exp(scores[k] - maxScore);
    let total = keys.reduce((s, k) => s + expScores[k], 0);

    let weights: Record<string, number> = {};
    for (const k of keys) weights[k] = expScores[k] / total;

    // Plancher.
    for (const k of keys) {
      if (weights[k] < Janus.MIN_WEIGHT) weights[k] = Janus.MIN_WEIGHT;
    }
    total = keys.reduce((s, k) => s + weights[k], 0);
    weights = renormalize(weights, keys, total);

    // Plafond.
    for (const k of keys) {
      if (weights[k] > Janus.MAX_WEIGHT) weights[k] = Janus.MAX_WEIGHT;
    }
    total = keys.reduce((s, k) => s + weights[k], 0);
    weights = renormalize(weights, keys, total);

    return weights;
  }

  /** Met à jour les poids des cohortes selon la précision récente. */
  updateWeights(outcomes: ScoredOutcome[]): void {
    const rawScores: Record<string, number> = {};
    for (const cohort of this.cohorts) {
      const metrics = this.calculateCohortMetrics(cohort, outcomes);
      this.cohortAccuracy[cohort] = metrics;

      // Score combiné : 50 % hit-rate + 50 % Sharpe normalisé (~0..1).
      const normSharpe = clamp01((metrics.sharpe + 1) / 2);
      rawScores[cohort] = 0.5 * metrics.hitRate + 0.5 * normSharpe;
    }
    this.cohortWeights = this.softmaxWithConstraints(rawScores);
  }

  /** Détecte le régime selon le différentiel de poids court/long. */
  regimeSignal(): Regime {
    const shortWeight = this.cohortWeights["18month"] ?? 0.5;
    const longWeight = this.cohortWeights["10year"] ?? 0.5;
    const diff = shortWeight - longWeight;

    if (diff > Janus.REGIME_THRESHOLD) return "NOVEL_REGIME";
    if (diff < -Janus.REGIME_THRESHOLD) return "HISTORICAL_REGIME";
    return "MIXED";
  }

  /** Fusionne les recommandations de toutes les cohortes selon les poids. */
  blendRecommendations(cohortRecs: Record<string, CohortRecommendations>): BlendResult {
    const cohortNames = Object.keys(cohortRecs);
    if (cohortNames.length === 0) {
      return { blendedRecommendations: [], contestedTickers: [] };
    }

    // ticker → liste de (cohorte, reco).
    const tickerRecs = new Map<string, Array<[string, Recommendation]>>();
    for (const cohort of cohortNames) {
      const recs = cohortRecs[cohort]?.recommendations ?? [];
      for (const rec of recs) {
        const ticker = rec.ticker;
        if (!ticker) continue;
        if (!tickerRecs.has(ticker)) tickerRecs.set(ticker, []);
        tickerRecs.get(ticker)!.push([cohort, rec]);
      }
    }

    const blended: BlendedRecommendation[] = [];
    const contested: string[] = [];
    for (const [ticker, list] of tickerRecs) {
      const result = this.blendTickerRecommendations(ticker, list);
      blended.push(result);
      if (result.contested) contested.push(ticker);
    }

    // Tri par conviction fusionnée décroissante.
    blended.sort((a, b) => b.conviction - a.conviction);

    return { blendedRecommendations: blended, contestedTickers: contested };
  }

  /** Fusionne les recos d'un seul ticker issues de plusieurs cohortes. */
  private blendTickerRecommendations(
    ticker: string,
    cohortRecList: Array<[string, Recommendation]>
  ): BlendedRecommendation {
    let longWeighted = 0;
    let shortWeighted = 0;
    let hasLong = false;
    let hasShort = false;

    for (const [cohort, rec] of cohortRecList) {
      const weight = this.cohortWeights[cohort] ?? 0;
      const direction = normalizeDirection(rec.direction);
      const conviction = rec.conviction ?? 50;
      if (direction === "LONG") {
        longWeighted += conviction * weight;
        hasLong = true;
      } else {
        shortWeighted += conviction * weight;
        hasShort = true;
      }
    }

    const contested = hasLong && hasShort;

    let direction: Direction;
    let baseConviction: number;
    let opposingConviction: number;
    if (longWeighted >= shortWeighted) {
      direction = "LONG";
      baseConviction = longWeighted;
      opposingConviction = shortWeighted;
    } else {
      direction = "SHORT";
      baseConviction = shortWeighted;
      opposingConviction = longWeighted;
    }

    // En cas de désaccord, on ampute la conviction de la moitié de l'opposition.
    const finalConviction = contested
      ? Math.max(0, baseConviction - opposingConviction * 0.5)
      : baseConviction;

    // Agents contributeurs, dédupliqués.
    const allAgents = Array.from(
      new Set(cohortRecList.flatMap(([, rec]) => rec.agents ?? []))
    );

    const cohortBreakdown: Record<string, CohortBreakdownEntry> = {};
    for (const [cohort, rec] of cohortRecList) {
      cohortBreakdown[cohort] = {
        conviction: rec.conviction,
        direction: rec.direction,
        weight: this.cohortWeights[cohort] ?? 0,
      };
    }

    return {
      ticker,
      direction,
      conviction: round1(finalConviction),
      contested,
      agents: allAgents,
      cohortBreakdown,
    };
  }

  /**
   * Cycle JANUS complet : met à jour les poids, fusionne les recos, détecte le
   * régime et renvoie la sortie du jour. Pas d'I/O — la persistance (sortie du
   * jour + historique) est à la charge de l'appelant, qui peut utiliser
   * historyEntry() sur le résultat.
   */
  runDaily(
    outcomes: ScoredOutcome[],
    cohortRecs: Record<string, CohortRecommendations>,
    today: string = isoDaysAgo(0)
  ): JanusOutput {
    this.updateWeights(outcomes);
    const blend = this.blendRecommendations(cohortRecs);
    const regime = this.regimeSignal();

    return {
      date: today,
      cohortWeights: roundRecord(this.cohortWeights, 4),
      regime,
      blendedRecommendations: blend.blendedRecommendations,
      contestedTickers: blend.contestedTickers,
      cohortAccuracy30d: roundMetrics(this.cohortAccuracy),
      generatedAt: new Date().toISOString(),
    };
  }
}

/** Extrait le résumé à archiver dans l'historique. */
export function historyEntry(output: JanusOutput): JanusHistoryEntry {
  return {
    date: output.date,
    cohortWeights: output.cohortWeights,
    regime: output.regime,
    cohortAccuracy30d: output.cohortAccuracy30d,
    numRecommendations: output.blendedRecommendations.length,
    numContested: output.contestedTickers.length,
  };
}

/* ─── Utilitaires purs ─────────────────────────────────────────────────── */

function normalizeDirection(d?: string): Direction {
  return (d ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
}

/** Date ISO (YYYY-MM-DD) il y a `days` jours, en UTC. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function renormalize(
  weights: Record<string, number>,
  keys: string[],
  total: number
): Record<string, number> {
  if (total <= 0) return weights;
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = weights[k] / total;
  return out;
}

function roundRecord(rec: Record<string, number>, digits: number): Record<string, number> {
  const f = 10 ** digits;
  const out: Record<string, number> = {};
  for (const k of Object.keys(rec)) out[k] = Math.round(rec[k] * f) / f;
  return out;
}

function roundMetrics(rec: Record<string, CohortMetrics>): Record<string, CohortMetrics> {
  const out: Record<string, CohortMetrics> = {};
  for (const k of Object.keys(rec)) {
    out[k] = { hitRate: round4(rec[k].hitRate), sharpe: round4(rec[k].sharpe) };
  }
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round1 = (x: number) => Math.round(x * 10) / 10;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
