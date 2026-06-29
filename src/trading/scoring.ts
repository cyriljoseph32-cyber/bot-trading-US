import { detectAll, type Detection, type SetupType } from "./detectors";
import type { Candle } from "./strategy";

/* ─── Scoring 0-100 (pur, testable) ────────────────────────────────────────
 *
 * Combine l'analyse technique (détecteurs), l'historique de performance du
 * setup (win-rate du backtest) et le sentiment news en une note unique, avec
 * le détail des contributions pour que l'assistant puisse l'expliquer.
 *
 *   90-100 : très forte opportunité
 *   70-89  : opportunité intéressante
 *   50-69  : surveillance
 *   <50    : ignorer
 */

export type ScoreBand = "tres_forte" | "interessante" | "surveillance" | "ignorer";

export interface ScoreContribution {
  label: string;
  points: number; // points effectivement accordés
  max: number; // points maximum possibles
}

export interface ScoreResult {
  score: number; // 0..100 (entier)
  band: ScoreBand;
  contributions: ScoreContribution[];
}

export interface ScoreInput {
  detections: Detection[];
  /** Win-rate historique du setup (0..1) — null si inconnu (→ neutre). */
  winRate: number | null;
  /** Sentiment news -1..1 — null si inconnu (→ neutre). Réservé Phase 4+. */
  newsSentiment?: number | null;
}

/** Poids des détecteurs techniques (total 60 pts). */
const TECH_WEIGHTS: Record<SetupType, number> = {
  // Recalibré pour la stratégie de RETOUR À LA MOYENNE (achat de repli) — fix #8.
  // On récompense la tendance de fond + le rebond de survente, pas la cassure/momentum.
  tendance: 18,
  retournement: 18,
  volatilite: 8,
  volume: 6,
  momentum: 5,
  cassure: 5,
};
const TECH_TOTAL = 60;
const WINRATE_MAX = 25;
const NEWS_MAX = 15;

export function bandFor(score: number): ScoreBand {
  if (score >= 90) return "tres_forte";
  if (score >= 70) return "interessante";
  if (score >= 50) return "surveillance";
  return "ignorer";
}

export function scoreSignal(input: ScoreInput): ScoreResult {
  const contributions: ScoreContribution[] = [];

  // 1) Technique : somme pondérée des forces des détecteurs présents.
  let tech = 0;
  for (const d of input.detections) {
    const w = TECH_WEIGHTS[d.type] ?? 0;
    const pts = d.present ? w * d.strength : 0;
    tech += pts;
    contributions.push({ label: `Technique : ${d.type}`, points: round1(pts), max: w });
  }

  // 2) Win-rate historique (null → neutre = la moitié des points).
  const wr = input.winRate;
  const wrPts = wr == null ? WINRATE_MAX / 2 : clamp01(wr) * WINRATE_MAX;
  contributions.push({ label: "Historique du setup (win-rate)", points: round1(wrPts), max: WINRATE_MAX });

  // 3) Sentiment news (null → neutre).
  const ns = input.newsSentiment;
  const nsPts = ns == null ? NEWS_MAX / 2 : ((clampS(ns) + 1) / 2) * NEWS_MAX;
  contributions.push({ label: "Sentiment news", points: round1(nsPts), max: NEWS_MAX });

  const raw = tech + wrPts + nsPts; // 0..100
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, band: bandFor(score), contributions };
}

/** Pratique : calcule le score directement à partir des bougies. */
export function scoreCandles(
  candles: Candle[],
  winRate: number | null,
  newsSentiment: number | null = null
): ScoreResult {
  return scoreSignal({ detections: detectAll(candles), winRate, newsSentiment });
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampS = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);
const round1 = (x: number) => Math.round(x * 10) / 10;

export { TECH_TOTAL, WINRATE_MAX, NEWS_MAX };
