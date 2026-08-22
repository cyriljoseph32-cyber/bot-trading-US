/* ─── Cœur SPC FX5 : évaluation d'un setup H1 (pur, sans I/O) ──────────────
 *
 * Philosophie conservée depuis « SPC FX5 Lite » : on ne prédit pas, on suit
 * une tendance confirmée, et on n'entre JAMAIS sur un signal ambigu.
 *
 * Alignement obligatoire (LONG ; SHORT strictement symétrique) :
 *   1. clôture H1 au-dessus de la SMA 200 ;
 *   2. SMA 200 orientée à la hausse (pente ≥ seuil) ;
 *   3. DI+ > DI- avec un écart minimal ;
 *   4. ADX au-dessus du seuil ;
 *   5. bascule UT Bot haussière confirmée À LA CLÔTURE ;
 *   6. (option) H4 haussier, (option) D1 haussier ;
 *   7. (option) breakout confirmé au-delà du range des N bougies.
 * Un seul critère manquant ⇒ pas d'entrée, avec le code de rejet exact.
 *
 * ⚠ Toutes les bougies reçues DOIVENT être closes. L'appelant (runner ou
 * backtest) ne transmet jamais la bougie en formation — c'est la garantie
 * « entrée uniquement après clôture de bougie ».
 */

import { sma, atr as atrSeries } from "../../../../src/trading/indicators";
import type { Bar, Quote, Side } from "../../types";
import {
  adx as adxSeries,
  utBot,
  slopePct,
  lastSwingHigh,
  lastSwingLow,
  lastOf,
} from "./indicators";
import { confirmBreakout } from "./breakout";
import { higherTfTrend, mtfAllows } from "./mtf";
import {
  antiChopFilter,
  costFilter,
  estimateCost,
  newsFilter,
  sessionFilter,
  volatilityFilter,
  volumeFilter,
  type CostEstimate,
  type FilterVerdict,
  type NewsEvent,
} from "./filters";
import type { Direction, SpcParams, StopParams } from "./params";
import type { SpcAsset, SpcNoteCode, SpcRejectCode, SpcScorePart, SpcSignal } from "./types";

export interface SpcSignalInput {
  asset: SpcAsset;
  /** Bougies H1 CLOSES, openTime croissant, aberrations exclues. */
  bars: Bar[];
  /** Bougies H4 agrégées depuis les bougies H1 closes. */
  barsH4: Bar[];
  /** Bougies D1 agrégées depuis les bougies H1 closes. */
  barsD1: Bar[];
  /** Dernière cotation (spread réel) — optionnelle. */
  quote: Quote | null;
  /** Annonces macro ; null = flux non connecté (filtre neutre). */
  news: NewsEvent[] | null;
  params: SpcParams;
  /** Surcharge de la bande de volatilité pour cet actif/catégorie. */
  volatilityBand?: { minAtrPct?: number; maxAtrPct?: number };
}

/** Calcul du stop et du take-profit d'un setup. */
export interface StopPlan {
  stopLoss: number;
  takeProfit: number;
  riskPerUnit: number;
  /** Distance du stop exprimée en multiples d'ATR. */
  atrMultiple: number;
  reject: SpcRejectCode | null;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Stop = la PLUS LARGE des deux références (volatilité et technique), pour ne
 * pas placer le stop à l'intérieur de la structure de prix. Le résultat doit
 * ensuite tenir dans la bande [minAtrMult ; maxAtrMult] : un stop trop serré
 * se fait balayer par le bruit, un stop trop large déforme le sizing.
 */
export function planStop(
  price: number,
  direction: Direction,
  atrValue: number | null,
  bars: Bar[],
  utBotStop: number | null,
  cfg: StopParams
): StopPlan {
  const empty: StopPlan = {
    stopLoss: 0,
    takeProfit: 0,
    riskPerUnit: 0,
    atrMultiple: 0,
    reject: "stop_invalid",
  };
  if (atrValue === null || !(atrValue > 0) || !(price > 0)) return empty;

  let distance = atrValue * cfg.atrMult;

  if (cfg.technical === "swing") {
    const level =
      direction === "long"
        ? lastSwingLow(bars.map((b) => b.low), cfg.swingLookback)
        : lastSwingHigh(bars.map((b) => b.high), cfg.swingLookback);
    if (level !== null) {
      const technicalDistance =
        direction === "long" ? price - level : level - price;
      if (technicalDistance > 0) distance = Math.max(distance, technicalDistance);
    }
  } else if (cfg.technical === "utbot" && utBotStop !== null) {
    const technicalDistance = direction === "long" ? price - utBotStop : utBotStop - price;
    if (technicalDistance > 0) distance = Math.max(distance, technicalDistance);
  }

  const atrMultiple = distance / atrValue;
  if (atrMultiple < cfg.minAtrMult) {
    return { ...empty, atrMultiple, reject: "stop_too_tight" };
  }
  if (atrMultiple > cfg.maxAtrMult) {
    return { ...empty, atrMultiple, reject: "stop_too_wide" };
  }

  const stopLoss = direction === "long" ? price - distance : price + distance;
  if (stopLoss <= 0) return empty;
  const takeProfit =
    direction === "long"
      ? price + distance * cfg.takeProfitR
      : price - distance * cfg.takeProfitR;
  if (takeProfit <= 0) return empty;

  return { stopLoss, takeProfit, riskPerUnit: distance, atrMultiple, reject: null };
}

/** Évalue un symbole sur sa dernière bougie H1 close. */
export function evaluateSpcFx5(input: SpcSignalInput): SpcSignal {
  const { asset, bars, params } = input;
  const rejects: SpcRejectCode[] = [];
  const notes: SpcNoteCode[] = [];
  const reasons: string[] = [];
  const parts: SpcScorePart[] = [];

  const lastBar = bars.at(-1);
  const price = lastBar?.close ?? 0;
  const ts = lastBar ? lastBar.openTime + 3_600_000 : 0;

  const base: SpcSignal = {
    symbol: asset.provider,
    std: asset.std,
    assetClass: asset.assetClass,
    category: asset.category,
    tf: "1h",
    side: "flat",
    score: 0,
    parts,
    reasons,
    rejects,
    notes,
    price,
    stopLoss: null,
    takeProfit: null,
    riskPerUnit: null,
    rrGross: null,
    rrNet: null,
    atr: null,
    ts,
    eligible: false,
  };

  if (bars.length < params.minBars) {
    rejects.push("data_insufficient");
    reasons.push(`${bars.length} bougies H1 < ${params.minBars} requises`);
    return base;
  }
  if (input.quote?.stale) {
    rejects.push("data_stale");
    reasons.push("cotation périmée");
    return base;
  }

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  /* ─── Indicateurs ──────────────────────────────────────────────────── */
  const smaSeries = sma(closes, params.trend.smaPeriod);
  const smaValue = lastOf(smaSeries);
  const slope = slopePct(smaSeries, params.trend.slopeLookback);
  const adxPoint = lastOf(adxSeries(highs, lows, closes, params.momentum.adxPeriod));
  const utBotPoint = lastOf(
    utBot(highs, lows, closes, {
      keyValue: params.utBot.keyValue,
      atrPeriod: params.utBot.atrPeriod,
    })
  );
  const atrValue = lastOf(atrSeries(highs, lows, closes, params.volatility.atrPeriod));
  base.atr = atrValue;

  if (smaValue === null || slope === null || adxPoint === null || utBotPoint === null || atrValue === null) {
    rejects.push("indicators_unavailable");
    reasons.push("indicateurs non calculables sur cet historique");
    return base;
  }

  /* ─── Direction candidate : position du prix vs SMA 200 ────────────── */
  let direction: Direction;
  if (price > smaValue) {
    direction = "long";
    reasons.push(`clôture ${price} au-dessus de la SMA ${params.trend.smaPeriod}`);
  } else if (price < smaValue) {
    direction = "short";
    reasons.push(`clôture ${price} sous la SMA ${params.trend.smaPeriod}`);
  } else {
    rejects.push("sma_not_aligned");
    reasons.push("clôture exactement sur la SMA — aucun sens de marché");
    return base;
  }

  /* ─── Alignement obligatoire ───────────────────────────────────────── */
  const slopeAligned =
    direction === "long"
      ? slope >= params.trend.minSlopePct
      : slope <= -params.trend.minSlopePct;
  if (!slopeAligned) {
    rejects.push("sma_slope_weak");
    reasons.push(`pente SMA ${slope.toFixed(3)}% insuffisante (seuil ±${params.trend.minSlopePct}%)`);
  }

  const diAligned =
    direction === "long"
      ? adxPoint.plusDi > adxPoint.minusDi
      : adxPoint.minusDi > adxPoint.plusDi;
  if (!diAligned) {
    rejects.push("di_not_aligned");
    reasons.push(`DI+ ${adxPoint.plusDi.toFixed(1)} / DI- ${adxPoint.minusDi.toFixed(1)} contredisent le sens`);
  }

  const diSum = adxPoint.plusDi + adxPoint.minusDi;
  const diSpread = diSum > 0 ? Math.abs(adxPoint.plusDi - adxPoint.minusDi) / diSum : 0;
  if (diAligned && diSpread < params.momentum.minDiSpread) {
    rejects.push("di_spread_weak");
    reasons.push(`écart DI ${diSpread.toFixed(2)} < ${params.momentum.minDiSpread}`);
  }

  if (adxPoint.adx < params.momentum.minAdx) {
    rejects.push("adx_below_threshold");
    reasons.push(`ADX ${adxPoint.adx.toFixed(1)} < ${params.momentum.minAdx}`);
  }

  // UT Bot : bascule confirmée à la clôture, du bon côté et assez récente.
  const flipMatches = utBotPoint.flip === direction;
  const positionMatches = utBotPoint.position === (direction === "long" ? 1 : -1);
  if (!flipMatches && !positionMatches) {
    rejects.push("utbot_no_flip");
    reasons.push("UT Bot n'est pas positionné dans le sens du signal");
  } else if (!flipMatches && utBotPoint.barsSinceFlip > params.utBot.maxBarsSinceFlip) {
    rejects.push("utbot_flip_stale");
    reasons.push(
      `bascule UT Bot vieille de ${utBotPoint.barsSinceFlip} bougies > ${params.utBot.maxBarsSinceFlip}`
    );
  } else {
    reasons.push(
      flipMatches
        ? "bascule UT Bot confirmée sur la clôture H1"
        : `UT Bot aligné (${utBotPoint.barsSinceFlip} bougie(s) depuis la bascule)`
    );
  }

  /* ─── Multi-timeframe (sans lookahead) ─────────────────────────────── */
  if (params.mtf.h4Enabled) {
    const trendH4 = higherTfTrend(input.barsH4, "4h", params.mtf.smaPeriod, ts);
    if (!mtfAllows(trendH4, direction)) {
      rejects.push("mtf_h4_conflict");
      reasons.push(`H4 ${trendH4} contredit un signal ${direction}`);
    } else {
      reasons.push(`H4 ${trendH4}`);
    }
  }
  if (params.mtf.d1Enabled) {
    const trendD1 = higherTfTrend(input.barsD1, "1d", params.mtf.smaPeriod, ts);
    if (!mtfAllows(trendD1, direction)) {
      rejects.push("mtf_d1_conflict");
      reasons.push(`D1 ${trendD1} contredit un signal ${direction}`);
    } else {
      reasons.push(`D1 ${trendD1}`);
    }
  }

  /* ─── Breakout ─────────────────────────────────────────────────────── */
  const breakout = confirmBreakout(
    highs,
    lows,
    price,
    direction,
    atrValue,
    params.breakout,
    asset.tickSize ?? 0
  );
  if (!breakout.confirmed) {
    rejects.push("breakout_not_confirmed");
    reasons.push(
      breakout.level === null
        ? "range de breakout non calculable"
        : `clôture ${price} n'a pas franchi ${breakout.level} + buffer ${breakout.buffer.toFixed(5)}`
    );
  } else if (breakout.level !== null) {
    reasons.push(`breakout confirmé au-delà de ${breakout.level}`);
  }

  /* ─── Filtres ──────────────────────────────────────────────────────── */
  const collect = (verdict: FilterVerdict): FilterVerdict => {
    if (!verdict.pass && verdict.reject) rejects.push(verdict.reject);
    if (verdict.note && !notes.includes(verdict.note)) notes.push(verdict.note);
    reasons.push(verdict.detail);
    return verdict;
  };

  const volatility = collect(
    volatilityFilter(atrValue, price, asset.category, params.volatility, input.volatilityBand)
  );
  const volume = collect(volumeFilter(volumes, asset.assetClass, params.volume));
  const session = collect(sessionFilter(asset, ts, params.session));
  collect(newsFilter(asset, ts, input.news, params.news));
  collect(antiChopFilter(price, smaValue, atrValue, params.antiChop));

  /* ─── Stop / take-profit / coûts ───────────────────────────────────── */
  const stopPlan = planStop(price, direction, atrValue, bars, utBotPoint.stop, params.stop);
  let cost: CostEstimate | null = null;
  if (stopPlan.reject) {
    rejects.push(stopPlan.reject);
    reasons.push(
      stopPlan.reject === "stop_too_tight"
        ? `stop à ${stopPlan.atrMultiple.toFixed(2)} ATR < ${params.stop.minAtrMult}`
        : stopPlan.reject === "stop_too_wide"
          ? `stop à ${stopPlan.atrMultiple.toFixed(2)} ATR > ${params.stop.maxAtrMult}`
          : "stop non calculable"
    );
  } else {
    base.stopLoss = round5(stopPlan.stopLoss);
    base.takeProfit = round5(stopPlan.takeProfit);
    base.riskPerUnit = round5(stopPlan.riskPerUnit);
    cost = estimateCost(
      price,
      stopPlan.riskPerUnit,
      params.stop.takeProfitR,
      asset,
      input.quote,
      params.cost
    );
    base.rrGross = round2(cost.rrGross);
    base.rrNet = round2(cost.rrNet);
    collect(costFilter(cost, params.cost));
  }

  /* ─── Score /100, composant par composant ──────────────────────────── */
  const w = params.weights;

  // 1. Alignement prix / SMA 200 : distance normalisée en ATR, pleine à 2 ATR.
  const distanceAtr = Math.abs(price - smaValue) / atrValue;
  addPart(parts, "smaAlignment", distanceAtr, w.smaAlignment * clamp01(distanceAtr / 2), w.smaAlignment,
    `prix à ${distanceAtr.toFixed(2)} ATR de la SMA ${params.trend.smaPeriod}`);

  // 2. Pente de la SMA : pleine à 5× le seuil minimal.
  const slopeTarget = Math.max(params.trend.minSlopePct * 5, 1e-9);
  const slopeScore = slopeAligned ? clamp01(Math.abs(slope) / slopeTarget) : 0;
  addPart(parts, "smaSlope", slope, w.smaSlope * slopeScore, w.smaSlope,
    `pente ${slope.toFixed(3)}% sur ${params.trend.slopeLookback} bougies`);

  // 3. Force de l'ADX : 0 au seuil minimal, plein à `strongAdx`.
  const adxRange = Math.max(params.momentum.strongAdx - params.momentum.minAdx, 1e-9);
  const adxScore = clamp01((adxPoint.adx - params.momentum.minAdx) / adxRange);
  addPart(parts, "adxStrength", adxPoint.adx, w.adxStrength * adxScore, w.adxStrength,
    `ADX ${adxPoint.adx.toFixed(1)} (seuil ${params.momentum.minAdx})`);

  // 4. Écart DI+/DI- : plein à 0,5 (soit DI dominant = 3× l'autre).
  const diScore = diAligned ? clamp01(diSpread / 0.5) : 0;
  addPart(parts, "diSpread", diSpread, w.diSpread * diScore, w.diSpread,
    `écart DI ${diSpread.toFixed(2)} (DI+ ${adxPoint.plusDi.toFixed(1)} / DI- ${adxPoint.minusDi.toFixed(1)})`);

  // 5. Qualité UT Bot : fraîcheur de la bascule (60 %) + marge au stop (40 %).
  const freshness = utBotPoint.flip === direction ? 1 : clamp01(1 - utBotPoint.barsSinceFlip / 5);
  const utDistanceAtr = Math.abs(price - utBotPoint.stop) / atrValue;
  const utScore = positionMatches ? 0.6 * freshness + 0.4 * clamp01(utDistanceAtr / 1.5) : 0;
  addPart(parts, "utBotQuality", utDistanceAtr, w.utBotQuality * utScore, w.utBotQuality,
    `bascule il y a ${utBotPoint.barsSinceFlip} bougie(s), marge ${utDistanceAtr.toFixed(2)} ATR`);

  // 6. Volatilité : pleine au centre de la bande, dégressive vers les bords.
  const volScore = volatilityScore(volatility, asset, params, input.volatilityBand);
  addPart(parts, "volatility", volatility.value, w.volatility * volScore, w.volatility, volatility.detail);

  // 7. Exécution : coût, liquidité et session pèsent chacun un tiers.
  const costScore = cost === null ? 0 : clamp01(cost.rrNet / Math.max(params.cost.minRrNet * 1.5, 1e-9));
  const volumeScore = volume.pass ? (volume.note === "volume_unavailable" ? 0.7 : 1) : 0;
  const sessionScore = session.pass ? 1 : 0;
  const execScore = (costScore + volumeScore + sessionScore) / 3;
  addPart(parts, "execution", cost?.costBps ?? 0, w.execution * execScore, w.execution,
    `coût ${cost ? `${cost.costBps.toFixed(1)} bps, RR net ${cost.rrNet.toFixed(2)}` : "non évaluable"} · ${volume.detail} · ${session.detail}`);

  const score = Math.round(parts.reduce((sum, p) => sum + p.points, 0));
  if (rejects.length === 0 && score < params.minScore) {
    rejects.push("score_below_min");
    reasons.push(`score ${score} < ${params.minScore}`);
  }
  // Aucun signal ambigu : la direction n'est publiée que si TOUT est aligné.
  const side: Side = rejects.length === 0 ? direction : "flat";

  return {
    ...base,
    side,
    score: Math.max(0, Math.min(100, score)),
    eligible: rejects.length === 0,
  };
}

/** Position dans la bande de volatilité : 1 au centre, 0,6 aux bords. */
function volatilityScore(
  verdict: FilterVerdict,
  asset: SpcAsset,
  params: SpcParams,
  override?: { minAtrPct?: number; maxAtrPct?: number }
): number {
  if (!params.volatility.enabled) return 1;
  if (!verdict.pass) return 0;
  const band = params.volatility.bands[asset.category];
  const min = override?.minAtrPct ?? band.minAtrPct;
  const max = override?.maxAtrPct ?? band.maxAtrPct;
  if (!(max > min)) return 1;
  const t = clamp01((verdict.value - min) / (max - min));
  return 1 - Math.abs(t - 0.5) * 2 * 0.4;
}

function addPart(
  parts: SpcScorePart[],
  component: SpcScorePart["component"],
  value: number,
  points: number,
  max: number,
  detail: string
): void {
  parts.push({
    component,
    value: round4(value),
    points: Math.round(Math.max(0, Math.min(max, points)) * 10) / 10,
    max,
    detail,
  });
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
