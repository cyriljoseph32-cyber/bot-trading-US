/* ─── Confirmation multi-timeframe (pur, sans lookahead) ───────────────────
 *
 * Le signal d'entrée reste en H1 ; H4 et D1 ne servent qu'à filtrer la
 * tendance dominante.
 *
 * ANTI-LOOKAHEAD — deux garde-fous cumulés :
 *   1. les bougies H4/D1 sont AGRÉGÉES à partir des bougies H1 déjà closes
 *      (bot/src/bars.ts → aggregateHigherTf), donc aucune donnée future ;
 *   2. `higherTfTrend` ignore en plus toute bougie supérieure dont la période
 *      ne serait pas terminée à l'instant `asOf` (clôture de la bougie H1
 *      évaluée). Une bougie H4 en cours ne peut donc jamais peser sur H1.
 */

import { sma } from "../../../../src/trading/indicators";
import { TF_MS, type Bar, type Timeframe } from "../../types";
import type { Direction } from "./params";

export type MtfTrend = Direction | "flat" | "unknown";

/**
 * Tendance d'un timeframe supérieur : clôture au-dessus/en-dessous de sa SMA,
 * ET SMA orientée dans le même sens.
 *
 * @param bars bougies du timeframe supérieur, openTime croissant
 * @param asOf horodatage de clôture de la bougie H1 évaluée
 */
export function higherTfTrend(
  bars: Bar[],
  tf: Timeframe,
  smaPeriod: number,
  asOf: number
): MtfTrend {
  const tfMs = TF_MS[tf];
  // Garde-fou 2 : uniquement les périodes entièrement terminées à `asOf`.
  const closed = bars.filter((b) => !b.outlier && b.openTime + tfMs <= asOf);
  if (closed.length < smaPeriod + 2) return "unknown";

  const closes = closed.map((b) => b.close);
  const smaSeries = sma(closes, smaPeriod);
  const current = smaSeries[smaSeries.length - 1];
  const previous = smaSeries[smaSeries.length - 2];
  const price = closes[closes.length - 1];
  if (current === null || previous === null) return "unknown";

  if (price > current && current > previous) return "long";
  if (price < current && current < previous) return "short";
  return "flat";
}

/**
 * true si la tendance du timeframe supérieur ne contredit pas `direction`.
 * Une tendance `unknown` (données insuffisantes) est NEUTRE : on ne bloque pas
 * sur une absence de données, on bloque sur une contradiction avérée.
 */
export function mtfAllows(trend: MtfTrend, direction: Direction): boolean {
  if (trend === "unknown") return true;
  return trend === direction;
}
