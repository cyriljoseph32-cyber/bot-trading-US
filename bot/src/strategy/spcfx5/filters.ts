/* ─── Filtres SPC FX5 (purs, chacun activable/désactivable) ────────────────
 *
 * Chaque filtre renvoie un verdict homogène : passé ou non, le code de rejet
 * associé, la valeur mesurée et une note éventuelle. Aucun filtre ne bloque
 * silencieusement : quand une donnée manque (volume FX, spread inconnu, flux
 * d'actualités absent), il le DIT via une note et reste neutre.
 */

import { sma } from "../../../../src/trading/indicators";
import { isExchangeOpen, isFxOpen } from "../../sessions";
import type { Quote } from "../../types";
import type {
  AntiChopParams,
  CostFilterParams,
  Direction,
  NewsFilterParams,
  SessionFilterParams,
  SpcCategory,
  VolatilityFilterParams,
  VolumeFilterParams,
} from "./params";
import type { SpcAsset, SpcNoteCode, SpcRejectCode } from "./types";

export interface FilterVerdict {
  pass: boolean;
  reject: SpcRejectCode | null;
  note: SpcNoteCode | null;
  /** Valeur mesurée (ATR%, coût en bps, ratio de volume…). */
  value: number;
  detail: string;
}

const ok = (value: number, detail: string, note: SpcNoteCode | null = null): FilterVerdict => ({
  pass: true,
  reject: null,
  note,
  value,
  detail,
});

const ko = (reject: SpcRejectCode, value: number, detail: string): FilterVerdict => ({
  pass: false,
  reject,
  note: null,
  value,
  detail,
});

/* ─── 1) Volatilité ──────────────────────────────────────────────────────── */

/**
 * ATR en % du prix dans la bande de la catégorie : trop bas, les frais mangent
 * le gain ; trop haut, le stop devient disproportionné.
 */
export function volatilityFilter(
  atrValue: number | null,
  price: number,
  category: SpcCategory,
  params: VolatilityFilterParams,
  override?: { minAtrPct?: number; maxAtrPct?: number }
): FilterVerdict {
  if (!params.enabled) return ok(0, "filtre volatilité désactivé");
  if (atrValue === null || !(atrValue > 0) || !(price > 0)) {
    return ko("volatility_too_low", 0, "ATR indisponible");
  }
  const atrPct = (atrValue / price) * 100;
  const band = params.bands[category];
  const min = override?.minAtrPct ?? band.minAtrPct;
  const max = override?.maxAtrPct ?? band.maxAtrPct;
  if (atrPct < min) return ko("volatility_too_low", atrPct, `ATR ${atrPct.toFixed(3)}% < ${min}%`);
  if (atrPct > max) return ko("volatility_too_high", atrPct, `ATR ${atrPct.toFixed(3)}% > ${max}%`);
  return ok(atrPct, `ATR ${atrPct.toFixed(3)}% dans [${min}% ; ${max}%]`);
}

/* ─── 2) Coût d'exécution ────────────────────────────────────────────────── */

export interface CostEstimate {
  /** Coût aller-retour retenu, en points de base. */
  costBps: number;
  /** Coût converti en unités de prix. */
  costPerUnit: number;
  /** RR avant coûts. */
  rrGross: number;
  /** RR après coûts (le seul qui compte pour décider). */
  rrNet: number;
  /** true si le spread réel a pu être mesuré (sinon : coût configuré). */
  spreadMeasured: boolean;
}

/**
 * Spread bid/ask OBSERVÉ, en points de base — null si non coté ou reconstitué.
 * Un bid/ask dérivé d'un coût configuré (`estimated`) n'est pas une mesure :
 * le renvoyer ici reviendrait à présenter une hypothèse comme un fait.
 */
export function spreadBps(quote: Quote | null): number | null {
  if (!quote || quote.estimated) return null;
  if (quote.bid === null || quote.ask === null || quote.bid <= 0) return null;
  const mid = (quote.bid + quote.ask) / 2;
  if (!(mid > 0)) return null;
  return ((quote.ask - quote.bid) / mid) * 10_000;
}

/**
 * Calcule le RR NET de coûts : le coût est payé à l'entrée et à la sortie, il
 * s'ajoute au risque et se retranche du gain. Un setup à RR 2 brut peut être
 * inexploitable une fois le spread payé — c'est ce que ce filtre attrape.
 */
export function estimateCost(
  price: number,
  riskPerUnit: number,
  takeProfitR: number,
  asset: SpcAsset,
  quote: Quote | null,
  params: CostFilterParams
): CostEstimate {
  const measured = spreadBps(quote);
  const spreadMeasured = measured !== null;
  const baseBps = measured ?? asset.costBps ?? params.defaultCostBps;
  const costBps = baseBps + params.slippageBps;
  const costPerUnit = price * (costBps / 10_000);

  const rewardGross = riskPerUnit * takeProfitR;
  const rrGross = riskPerUnit > 0 ? rewardGross / riskPerUnit : 0;
  const riskNet = riskPerUnit + costPerUnit;
  const rewardNet = rewardGross - costPerUnit;
  const rrNet = riskNet > 0 ? rewardNet / riskNet : 0;

  return { costBps, costPerUnit, rrGross, rrNet, spreadMeasured };
}

export function costFilter(estimate: CostEstimate, params: CostFilterParams): FilterVerdict {
  if (!params.enabled) return ok(estimate.costBps, "filtre de coût désactivé");
  const note: SpcNoteCode | null = estimate.spreadMeasured ? null : "spread_unknown";
  if (estimate.rrNet < params.minRrNet) {
    // Le rejet conserve la note : savoir que le coût était ESTIMÉ change
    // l'interprétation du refus.
    return {
      ...ko(
        "cost_too_high",
        estimate.rrNet,
        `RR net ${estimate.rrNet.toFixed(2)} < ${params.minRrNet} (coût ${estimate.costBps.toFixed(1)} bps)`
      ),
      note,
    };
  }
  return ok(
    estimate.rrNet,
    `RR net ${estimate.rrNet.toFixed(2)} (coût ${estimate.costBps.toFixed(1)} bps)`,
    note
  );
}

/* ─── 3) Volume / liquidité ──────────────────────────────────────────────── */

/**
 * Volume de la dernière bougie vs sa moyenne. Le FX spot n'a PAS de volume
 * consolidé : on le signale explicitement (`volume_unavailable`) et on reste
 * neutre — jamais de pénalité pour une donnée que le marché ne publie pas.
 */
export function volumeFilter(
  volumes: number[],
  assetClass: string,
  params: VolumeFilterParams
): FilterVerdict {
  if (!params.enabled) return ok(0, "filtre de volume désactivé");
  const hasVolume = assetClass !== "fx" && volumes.some((v) => v > 0);
  if (!hasVolume) {
    return ok(0, "volume non publié par le marché (FX spot / données absentes)", "volume_unavailable");
  }
  const series = sma(volumes, params.lookback);
  const average = series[series.length - 1];
  const latest = volumes[volumes.length - 1];
  if (average === null || !(average > 0)) {
    return ok(0, "moyenne de volume indisponible", "volume_unavailable");
  }
  const ratio = latest / average;
  if (ratio < params.minRatio) {
    return ko("volume_thin", ratio, `volume ${ratio.toFixed(2)}× la moyenne < ${params.minRatio}×`);
  }
  return ok(ratio, `volume ${ratio.toFixed(2)}× la moyenne`);
}

/* ─── 4) Session ─────────────────────────────────────────────────────────── */

function inWindow(minuteOfDay: number, open: number, close: number): boolean {
  // Fenêtre passant minuit (ex. 22:00 → 06:00).
  return open <= close
    ? minuteOfDay >= open && minuteOfDay < close
    : minuteOfDay >= open || minuteOfDay < close;
}

function utcMinuteOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Séance autorisée pour l'actif :
 *   • FX      → marché FX ouvert ET dans une des sessions configurées ;
 *   • crypto  → 24/7, sauf heures creuses explicitement exclues ;
 *   • autres  → séance principale de leur exchange (bot/src/sessions.ts).
 */
export function sessionFilter(
  asset: SpcAsset,
  ts: number,
  params: SessionFilterParams
): FilterVerdict {
  if (!params.enabled) return ok(0, "filtre de session désactivé");
  const minute = utcMinuteOfDay(ts);

  if (asset.category === "crypto" || asset.exchange.toUpperCase() === "CRYPTO") {
    const blocked = params.cryptoExcluded.find((w) => inWindow(minute, w.openMin, w.closeMin));
    return blocked
      ? ko("session_closed", minute, `heures creuses crypto (${blocked.name})`)
      : ok(minute, "crypto 24/7");
  }

  // Les métaux et matières premières cotés en spot suivent le calendrier FX,
  // pas celui d'une bourse : on se base sur l'exchange, pas sur la catégorie.
  if (asset.category.startsWith("fx_") || asset.exchange.toUpperCase() === "FOREX") {
    if (!isFxOpen(ts)) return ko("session_closed", minute, "marché FX/spot fermé (week-end)");
    if (params.fx.length === 0) return ok(minute, "FX : aucune restriction de session");
    const active = params.fx.find((w) => inWindow(minute, w.openMin, w.closeMin));
    return active
      ? ok(minute, `session ${active.name}`)
      : ko("session_closed", minute, "hors sessions Londres/New York");
  }

  if (!params.requireExchangeSession) return ok(minute, "séance non exigée");
  return isExchangeOpen(asset.exchange, ts)
    ? ok(minute, `séance ${asset.exchange} ouverte`)
    : ko("session_closed", minute, `séance ${asset.exchange} fermée`);
}

/* ─── 5) Événements macroéconomiques ─────────────────────────────────────── */

export interface NewsEvent {
  /** Horodatage de l'annonce, ms epoch UTC. */
  ts: number;
  impact: "high" | "medium" | "low";
  /** Devises concernées (ISO 4217). Absent/vide = annonce mondiale. */
  currencies?: string[];
  /** Symboles standards concernés. Absent/vide = pas de ciblage par symbole. */
  symbols?: string[];
  title?: string;
}

/** Devises portées par un actif (les deux jambes d'une paire FX incluses). */
export function assetCurrencies(asset: SpcAsset): string[] {
  const out = new Set<string>([asset.currency.toUpperCase()]);
  const std = asset.std.toUpperCase();
  if (asset.category.startsWith("fx_") && /^[A-Z]{6}$/.test(std)) {
    out.add(std.slice(0, 3));
    out.add(std.slice(3));
  }
  return [...out];
}

function eventConcerns(event: NewsEvent, asset: SpcAsset): boolean {
  const symbols = event.symbols ?? [];
  const currencies = event.currencies ?? [];
  if (symbols.length === 0 && currencies.length === 0) return true; // annonce mondiale
  if (symbols.some((s) => s.toUpperCase() === asset.std.toUpperCase())) return true;
  const mine = assetCurrencies(asset);
  return currencies.some((c) => mine.includes(c.toUpperCase()));
}

/**
 * Blocage des NOUVELLES entrées autour d'une annonce à fort impact.
 *
 * Une liste vide est traitée comme « flux non connecté » : le filtre reste
 * neutre et le signale (`news_feed_absent`). La stratégie fonctionne donc
 * sans flux d'actualités — elle ne fait juste pas ce filtrage.
 *
 * Ce filtre ne ferme JAMAIS de position ; `closePositionsOnNews` est lu
 * ailleurs (runner), et vaut false par défaut.
 */
export function newsFilter(
  asset: SpcAsset,
  ts: number,
  events: NewsEvent[] | null,
  params: NewsFilterParams
): FilterVerdict {
  if (!params.enabled) return ok(0, "filtre news désactivé");
  if (events === null || events.length === 0) {
    return ok(0, "aucun flux d'actualités connecté", "news_feed_absent");
  }
  const beforeMs = params.minutesBefore * 60_000;
  const afterMs = params.minutesAfter * 60_000;
  const blocking = events.find(
    (e) =>
      e.impact === "high" &&
      ts >= e.ts - beforeMs &&
      ts <= e.ts + afterMs &&
      eventConcerns(e, asset)
  );
  if (blocking) {
    const minutes = Math.round((blocking.ts - ts) / 60_000);
    return ko(
      "news_blackout",
      minutes,
      `annonce à fort impact ${minutes >= 0 ? `dans ${minutes}` : `il y a ${-minutes}`} min` +
        (blocking.title ? ` (${blocking.title})` : "")
    );
  }
  return ok(0, "aucune annonce à fort impact dans la fenêtre");
}

/* ─── 6) Anti-chop ───────────────────────────────────────────────────────── */

/**
 * Distance minimale entre le prix et la SMA de tendance, exprimée en ATR.
 * Trop près de la moyenne, le prix oscille : le stop est touché des deux côtés.
 * (Les seuils ADX et de pente sont vérifiés dans l'alignement du signal.)
 */
export function antiChopFilter(
  price: number,
  smaValue: number | null,
  atrValue: number | null,
  params: AntiChopParams
): FilterVerdict {
  if (!params.enabled || params.minDistanceToSmaAtr <= 0) {
    return ok(0, "filtre anti-chop désactivé");
  }
  if (smaValue === null || atrValue === null || !(atrValue > 0)) {
    return ok(0, "distance à la SMA non mesurable");
  }
  const distanceAtr = Math.abs(price - smaValue) / atrValue;
  if (distanceAtr < params.minDistanceToSmaAtr) {
    return ko(
      "chop_too_close_to_sma",
      distanceAtr,
      `prix à ${distanceAtr.toFixed(2)} ATR de la SMA < ${params.minDistanceToSmaAtr}`
    );
  }
  return ok(distanceAtr, `prix à ${distanceAtr.toFixed(2)} ATR de la SMA`);
}

/* ─── Utilitaire ─────────────────────────────────────────────────────────── */

/** Direction opposée — utilisé par le scoring et les groupes de corrélation. */
export function opposite(direction: Direction): Direction {
  return direction === "long" ? "short" : "long";
}
