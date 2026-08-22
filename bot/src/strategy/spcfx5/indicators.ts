/* ─── Indicateurs SPC FX5 (purs, sans I/O, testables) ──────────────────────
 *
 * Complète src/trading/indicators.ts (sma, rsi, atr — réutilisés tels quels)
 * avec ce dont la stratégie SPC FX5 a besoin :
 *   • ADX + DI+/DI- (lissage de Wilder) — force et sens du momentum ;
 *   • UT Bot (stop suiveur ATR) — timing d'entrée ;
 *   • pente d'une moyenne mobile — direction macro ;
 *   • swings hauts/bas — niveau technique du stop ;
 *   • canal de Donchian — référence de breakout.
 *
 * Convention identique à l'existant : les séries renvoient `null` tant que la
 * fenêtre n'est pas pleine, jamais de valeur approximative.
 */

import { atr } from "../../../../src/trading/indicators";

/* ─── ADX / DI (Wilder) ──────────────────────────────────────────────────── */

export interface AdxPoint {
  adx: number;
  plusDi: number;
  minusDi: number;
}

/**
 * ADX et Directional Indicators de Wilder.
 *
 * `+DM` et `-DM` sont les mouvements directionnels bruts, lissés sur `period`
 * comme le True Range ; l'ADX est la moyenne lissée du DX. La première valeur
 * d'ADX n'apparaît qu'après 2×period barres — avant, la série vaut `null`.
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): (AdxPoint | null)[] {
  const n = closes.length;
  const out: (AdxPoint | null)[] = new Array(n).fill(null);
  if (n <= period * 2) return out;

  // Mouvements directionnels et True Range barre par barre.
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  // Amorçage : somme des `period` premières valeurs.
  let smTr = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= period; i++) {
    smTr += tr[i];
    smPlus += plusDm[i];
    smMinus += minusDm[i];
  }

  const dxs: Array<{ index: number; dx: number; plusDi: number; minusDi: number }> = [];
  for (let i = period + 1; i < n; i++) {
    // Lissage de Wilder : on retire 1/period de l'accumulateur, on ajoute la barre.
    smTr = smTr - smTr / period + tr[i];
    smPlus = smPlus - smPlus / period + plusDm[i];
    smMinus = smMinus - smMinus / period + minusDm[i];
    if (smTr === 0) continue;
    const plusDi = (smPlus / smTr) * 100;
    const minusDi = (smMinus / smTr) * 100;
    const sum = plusDi + minusDi;
    const dx = sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100;
    dxs.push({ index: i, dx, plusDi, minusDi });
  }

  if (dxs.length < period) return out;

  // Premier ADX = moyenne simple des `period` premiers DX, puis lissage.
  let adxValue = dxs.slice(0, period).reduce((s, d) => s + d.dx, 0) / period;
  const first = dxs[period - 1];
  out[first.index] = { adx: adxValue, plusDi: first.plusDi, minusDi: first.minusDi };

  for (let k = period; k < dxs.length; k++) {
    const d = dxs[k];
    adxValue = (adxValue * (period - 1) + d.dx) / period;
    out[d.index] = { adx: adxValue, plusDi: d.plusDi, minusDi: d.minusDi };
  }
  return out;
}

/* ─── UT Bot (stop suiveur ATR) ──────────────────────────────────────────── */

export interface UtBotOptions {
  /** Coefficient appliqué à l'ATR (« Key Value » — sensibilité). */
  keyValue: number;
  /** Période de l'ATR du stop suiveur. */
  atrPeriod: number;
}

export const DEFAULT_UT_BOT: UtBotOptions = { keyValue: 1, atrPeriod: 10 };

export interface UtBotPoint {
  /** Niveau du stop suiveur. */
  stop: number;
  /** Position courante : +1 au-dessus du stop, -1 en dessous. */
  position: 1 | -1;
  /** Bascule survenue SUR cette barre (null sinon). */
  flip: "long" | "short" | null;
  /** Nombre de barres écoulées depuis la dernière bascule. */
  barsSinceFlip: number;
}

/**
 * UT Bot : stop suiveur à distance `keyValue × ATR(atrPeriod)`.
 *
 * Récurrence standard — le stop ne recule jamais tant que le prix reste du
 * même côté ; il est reprojeté à la distance nominale dès que le prix traverse.
 * Un flip « long » se produit sur la barre où la clôture repasse au-dessus du
 * stop précédent (et inversement pour « short »).
 */
export function utBot(
  highs: number[],
  lows: number[],
  closes: number[],
  options: UtBotOptions = DEFAULT_UT_BOT
): (UtBotPoint | null)[] {
  const n = closes.length;
  const out: (UtBotPoint | null)[] = new Array(n).fill(null);
  const atrSeries = atr(highs, lows, closes, options.atrPeriod);

  let prevStop: number | null = null;
  let position: 1 | -1 = 1;
  let barsSinceFlip = 0;

  for (let i = 0; i < n; i++) {
    const atrValue = atrSeries[i];
    if (atrValue === null || !(atrValue > 0)) continue;
    const nLoss = options.keyValue * atrValue;
    const close = closes[i];
    const prevClose = closes[i - 1] ?? close;

    let stop: number;
    if (prevStop === null) {
      // Amorçage : on se cale du côté du prix, sans flip.
      stop = close - nLoss;
      position = 1;
      prevStop = stop;
      barsSinceFlip = 0;
      out[i] = { stop, position, flip: null, barsSinceFlip };
      continue;
    }

    if (close > prevStop && prevClose > prevStop) {
      stop = Math.max(prevStop, close - nLoss); // tendance haussière : le stop monte
    } else if (close < prevStop && prevClose < prevStop) {
      stop = Math.min(prevStop, close + nLoss); // tendance baissière : le stop descend
    } else {
      stop = close > prevStop ? close - nLoss : close + nLoss; // traversée : reprojection
    }

    let flip: "long" | "short" | null = null;
    if (prevClose <= prevStop && close > prevStop) flip = "long";
    else if (prevClose >= prevStop && close < prevStop) flip = "short";

    if (flip === "long") {
      position = 1;
      barsSinceFlip = 0;
    } else if (flip === "short") {
      position = -1;
      barsSinceFlip = 0;
    } else {
      barsSinceFlip += 1;
    }

    out[i] = { stop, position, flip, barsSinceFlip };
    prevStop = stop;
  }
  return out;
}

/* ─── Pente, swings, Donchian ────────────────────────────────────────────── */

/**
 * Pente d'une série sur `lookback` barres, en % de la valeur de départ.
 * Renvoie `null` si la fenêtre n'est pas disponible.
 */
export function slopePct(series: (number | null)[], lookback: number): number | null {
  if (lookback < 1 || series.length < lookback + 1) return null;
  const current = series[series.length - 1];
  const past = series[series.length - 1 - lookback];
  if (current === null || past === null || past === 0) return null;
  return ((current - past) / Math.abs(past)) * 100;
}

/**
 * Dernier swing haut : plus haut d'un pivot entouré de `lookback` barres plus
 * basses de chaque côté. `null` si aucun pivot confirmé dans la fenêtre.
 */
export function lastSwingHigh(highs: number[], lookback = 3): number | null {
  for (let i = highs.length - 1 - lookback; i >= lookback; i--) {
    let isPivot = true;
    for (let k = 1; k <= lookback; k++) {
      if (highs[i - k] >= highs[i] || highs[i + k] >= highs[i]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) return highs[i];
  }
  return null;
}

/** Dernier swing bas — symétrique de `lastSwingHigh`. */
export function lastSwingLow(lows: number[], lookback = 3): number | null {
  for (let i = lows.length - 1 - lookback; i >= lookback; i--) {
    let isPivot = true;
    for (let k = 1; k <= lookback; k++) {
      if (lows[i - k] <= lows[i] || lows[i + k] <= lows[i]) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) return lows[i];
  }
  return null;
}

export interface DonchianChannel {
  upper: number;
  lower: number;
}

/**
 * Canal de Donchian sur les `period` barres PRÉCÉDANT la dernière (exclue) :
 * la bougie évaluée ne fait pas partie de son propre range, sinon un breakout
 * serait impossible à détecter.
 */
export function donchian(
  highs: number[],
  lows: number[],
  period: number
): DonchianChannel | null {
  if (period < 1 || highs.length < period + 1) return null;
  const start = highs.length - 1 - period;
  const end = highs.length - 1;
  let upper = -Infinity;
  let lower = Infinity;
  for (let i = start; i < end; i++) {
    upper = Math.max(upper, highs[i]);
    lower = Math.min(lower, lows[i]);
  }
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return null;
  return { upper, lower };
}

/** Dernière valeur non nulle d'une série indicatrice. */
export function lastOf<T>(series: (T | null)[]): T | null {
  return series.length > 0 ? series[series.length - 1] : null;
}
