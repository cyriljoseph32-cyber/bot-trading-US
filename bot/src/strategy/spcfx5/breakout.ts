/* ─── Confirmation de breakout (pur) ───────────────────────────────────────
 *
 * Un breakout n'est retenu que sur une CLÔTURE franche au-delà du plus haut
 * (ou plus bas) des N bougies précédentes, augmenté d'un buffer. Le buffer
 * évite de valider un dépassement d'un tick, qui n'est que du bruit.
 *
 * Buffer = max(bufferAtrMult × ATR, bufferTicks × tickSize).
 */

import { donchian } from "./indicators";
import type { BreakoutParams, Direction } from "./params";

export interface BreakoutResult {
  confirmed: boolean;
  /** Niveau du range franchi (plus haut/bas des N bougies précédentes). */
  level: number | null;
  /** Buffer appliqué au-dessus/en-dessous du niveau. */
  buffer: number;
  /** Distance de la clôture au niveau requis (négative = pas franchi). */
  margin: number | null;
}

export function confirmBreakout(
  highs: number[],
  lows: number[],
  close: number,
  direction: Direction,
  atrValue: number | null,
  params: BreakoutParams,
  tickSize = 0
): BreakoutResult {
  if (!params.enabled) {
    return { confirmed: true, level: null, buffer: 0, margin: null };
  }

  const channel = donchian(highs, lows, params.lookback);
  if (!channel) return { confirmed: false, level: null, buffer: 0, margin: null };

  const atrBuffer = atrValue !== null && atrValue > 0 ? atrValue * params.bufferAtrMult : 0;
  const tickBuffer = params.bufferTicks * tickSize;
  const buffer = Math.max(atrBuffer, tickBuffer);

  if (direction === "long") {
    const required = channel.upper + buffer;
    return {
      confirmed: close > required,
      level: channel.upper,
      buffer,
      margin: close - required,
    };
  }
  const required = channel.lower - buffer;
  return {
    confirmed: close < required,
    level: channel.lower,
    buffer,
    margin: required - close,
  };
}
