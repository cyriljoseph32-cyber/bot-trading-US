import { sma, rsi, atr } from "./indicators";
import type { Candle } from "./strategy";

/* ─── Détecteurs de setups (purs, testables) ───────────────────────────────
 *
 * Chaque détecteur examine la DERNIÈRE bougie et renvoie :
 *   present  : le setup est-il là ?
 *   strength : intensité normalisée 0..1 (alimente le scoring Phase 4)
 *   detail   : explication lisible (alimente l'assistant Phase 5)
 *
 * Tout est déterministe : aucune I/O, aucune lecture d'environnement.
 */

export type SetupType =
  | "tendance"
  | "cassure"
  | "momentum"
  | "volatilite"
  | "volume"
  | "retournement";

export interface Detection {
  type: SetupType;
  present: boolean;
  strength: number; // 0..1
  detail: string;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lastNonNull = (a: (number | null)[]): number | null => {
  const v = a[a.length - 1];
  return v ?? null;
};

interface Ctx {
  n: number;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[] | null;
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  volSma20: (number | null)[] | null;
}

function buildCtx(candles: Candle[]): Ctx {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const hasVol = candles.every((c) => typeof c.volume === "number");
  const volumes = hasVol ? candles.map((c) => c.volume as number) : null;
  return {
    n: candles.length,
    closes,
    highs,
    lows,
    volumes,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    atr14: atr(highs, lows, closes, 14),
    volSma20: volumes ? sma(volumes, 20) : null,
  };
}

function detectTendance(x: Ctx): Detection {
  const i = x.n - 1;
  const c = x.closes[i];
  const s50 = x.sma50[i];
  const s200 = x.sma200[i];
  if (s50 == null || s200 == null) {
    return { type: "tendance", present: false, strength: 0, detail: "Historique insuffisant" };
  }
  const up = c > s200 && s50 > s200;
  // Force = distance du prix au-dessus de la MM200, plafonnée à ~15 %.
  const strength = clamp01(((c - s200) / s200) / 0.15);
  return {
    type: "tendance",
    present: up,
    strength: up ? strength : 0,
    detail: up
      ? `Tendance haussière (prix ${(((c - s200) / s200) * 100).toFixed(1)} % au-dessus de la MM200)`
      : "Pas de tendance haussière (sous la MM200)",
  };
}

function detectCassure(x: Ctx): Detection {
  const i = x.n - 1;
  const look = 20;
  if (i < look) return { type: "cassure", present: false, strength: 0, detail: "Historique insuffisant" };
  let priorHigh = -Infinity;
  for (let k = i - look; k < i; k++) priorHigh = Math.max(priorHigh, x.highs[k]);
  const c = x.closes[i];
  const present = c > priorHigh;
  const strength = present ? clamp01(((c - priorHigh) / priorHigh) / 0.05) : 0;
  return {
    type: "cassure",
    present,
    strength,
    detail: present
      ? `Cassure du plus-haut ${look} séances (${priorHigh.toFixed(2)})`
      : `Sous le plus-haut ${look} séances (${priorHigh === -Infinity ? "n/a" : priorHigh.toFixed(2)})`,
  };
}

function detectMomentum(x: Ctx): Detection {
  const i = x.n - 1;
  const roLook = 10;
  if (i < roLook) return { type: "momentum", present: false, strength: 0, detail: "Historique insuffisant" };
  const roc = (x.closes[i] / x.closes[i - roLook] - 1) * 100; // % sur 10 séances
  const r = x.rsi14[i];
  const rising = r != null && r >= 55;
  const present = roc > 0 && rising;
  const strength = present ? clamp01(roc / 10) : 0; // 10 % sur 10 séances = fort
  return {
    type: "momentum",
    present,
    strength,
    detail: present
      ? `Momentum positif (+${roc.toFixed(1)} % / ${roLook}j, RSI ${r!.toFixed(0)})`
      : "Momentum faible",
  };
}

function detectVolatilite(x: Ctx): Detection {
  const i = x.n - 1;
  const a = x.atr14[i];
  const c = x.closes[i];
  if (a == null || c <= 0) return { type: "volatilite", present: false, strength: 0, detail: "Historique insuffisant" };
  const atrPct = (a / c) * 100;
  // Expansion : ATR du jour vs ATR 10 séances plus tôt.
  const aPrev = i >= 10 ? x.atr14[i - 10] : null;
  const expanding = aPrev != null && a > aPrev;
  const present = atrPct >= 2; // volatilité notable
  const strength = clamp01(atrPct / 6); // 6 % ATR = très volatil
  return {
    type: "volatilite",
    present,
    strength,
    detail: `ATR ${atrPct.toFixed(1)} % du prix${expanding ? ", en expansion" : ""}`,
  };
}

function detectVolume(x: Ctx): Detection {
  const i = x.n - 1;
  if (!x.volumes || !x.volSma20) {
    return { type: "volume", present: false, strength: 0, detail: "Volume indisponible" };
  }
  const v = x.volumes[i];
  const avg = x.volSma20[i];
  if (avg == null || avg <= 0) return { type: "volume", present: false, strength: 0, detail: "Historique insuffisant" };
  const ratio = v / avg;
  const present = ratio >= 1.5; // volume anormalement élevé
  const strength = clamp01((ratio - 1) / 2); // 3× la moyenne = max
  return {
    type: "volume",
    present,
    strength,
    detail: present ? `Volume ${ratio.toFixed(1)}× la moyenne 20j` : `Volume normal (${ratio.toFixed(1)}×)`,
  };
}

function detectRetournement(x: Ctx): Detection {
  const i = x.n - 1;
  if (i < 1) return { type: "retournement", present: false, strength: 0, detail: "Historique insuffisant" };
  const r = x.rsi14[i];
  const s200 = x.sma200[i];
  const turningUp = x.closes[i] > x.closes[i - 1];
  // Rebond potentiel : RSI sorti de survente, retournement haussier en tendance de fond.
  const present = r != null && r < 40 && turningUp && s200 != null && x.closes[i] > s200;
  const strength = present && r != null ? clamp01((40 - r) / 40) : 0;
  return {
    type: "retournement",
    present,
    strength,
    detail: present
      ? `Rebond de survente (RSI ${r!.toFixed(0)}, retournement haussier)`
      : "Pas de signal de retournement",
  };
}

/** Lance tous les détecteurs sur la dernière bougie. */
export function detectAll(candles: Candle[]): Detection[] {
  if (candles.length < 25) {
    return (["tendance", "cassure", "momentum", "volatilite", "volume", "retournement"] as SetupType[]).map(
      (type) => ({ type, present: false, strength: 0, detail: "Historique insuffisant" })
    );
  }
  const x = buildCtx(candles);
  return [
    detectTendance(x),
    detectCassure(x),
    detectMomentum(x),
    detectVolatilite(x),
    detectVolume(x),
    detectRetournement(x),
  ];
}

/** Indique si lastNonNull existe (helper exporté pour tests éventuels). */
export { lastNonNull };
