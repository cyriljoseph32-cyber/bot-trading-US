/* ─── Agrégation de bougies 1m/5m/15m (pur, testable) ──────────────────────
 *
 * Ticks → bougies 1 minute, puis roll-up 5m/15m. Gère :
 *   • déduplication : un tick au même horodatage exact que le précédent et au
 *     même prix est ignoré ;
 *   • trous de données : la bougie qui suit un trou est marquée gapBefore ;
 *   • valeurs aberrantes : variation extrême vs la bougie précédente → flag
 *     outlier (exclue des indicateurs, conservée pour audit).
 */

import type { Bar, Quote, Timeframe } from "./types";
import { TF_MS, TIMEFRAMES } from "./types";

/** Variation max plausible entre 2 bougies consécutives (par classe, en %). */
const OUTLIER_MOVE_PCT: Record<string, number> = { equity: 10, fx: 3, crypto: 20 };

export interface BarCloseEvent {
  bar: Bar;
}

const HISTORY_KEEP = 600; // bougies conservées par (symbole, tf)

export class BarAggregator {
  /** Bougies en cours de construction, par "symbol|tf". */
  private building = new Map<string, Bar>();
  /** Historique clos, par "symbol|tf" (ordonné, openTime croissant). */
  private history = new Map<string, Bar[]>();
  /** Dernier tick vu par symbole (déduplication). */
  private lastTick = new Map<string, { ts: number; price: number }>();

  constructor(
    private readonly onClose: (event: BarCloseEvent) => void,
    /** Timeframes agrégés à partir des ticks (défaut : 1m/5m/15m). */
    private readonly timeframes: Timeframe[] = TIMEFRAMES
  ) {}

  private key(symbol: string, tf: Timeframe): string {
    return `${symbol}|${tf}`;
  }

  /** Amorce l'historique avec des bougies importées (REST) ; dédupliquées par openTime. */
  seed(bars: Bar[]): void {
    for (const bar of bars) {
      const key = this.key(bar.symbol, bar.tf);
      const hist = this.history.get(key) ?? [];
      if (hist.some((b) => b.openTime === bar.openTime)) continue;
      hist.push(bar);
      hist.sort((a, b) => a.openTime - b.openTime);
      if (hist.length > HISTORY_KEEP) hist.splice(0, hist.length - HISTORY_KEEP);
      this.history.set(key, hist);
    }
  }

  /** Ingestion d'une cotation temps réel. */
  onQuote(quote: Quote, assetClass: string = quote.assetClass): void {
    // Déduplication : même horodatage + même prix que le tick précédent.
    const prev = this.lastTick.get(quote.symbol);
    if (prev && prev.ts === quote.ts && prev.price === quote.last) return;
    this.lastTick.set(quote.symbol, { ts: quote.ts, price: quote.last });

    for (const tf of this.timeframes) {
      this.ingest(quote, tf, assetClass);
    }
  }

  private ingest(quote: Quote, tf: Timeframe, assetClass: string): void {
    const tfMs = TF_MS[tf];
    const openTime = Math.floor(quote.ts / tfMs) * tfMs;
    const key = this.key(quote.symbol, tf);
    const current = this.building.get(key);

    if (current && current.openTime === openTime) {
      current.high = Math.max(current.high, quote.last);
      current.low = Math.min(current.low, quote.last);
      current.close = quote.last;
      if (quote.volume !== null) current.volume = quote.volume;
      current.ticks += 1;
      return;
    }

    // Nouvelle période : clore la bougie en cours (si plus ancienne).
    if (current && current.openTime < openTime) {
      this.close(key, current, assetClass);
      // Trou : il manque une ou plusieurs périodes complètes entre les deux.
      const gap = openTime - current.openTime > tfMs;
      this.building.set(key, newBar(quote, tf, openTime, gap));
      return;
    }

    // Tick en retard (openTime < bougie courante) : ignoré — déjà clos.
    if (current && current.openTime > openTime) return;

    this.building.set(key, newBar(quote, tf, openTime, false));
  }

  private close(key: string, bar: Bar, assetClass: string): void {
    const hist = this.history.get(key) ?? [];
    // Déduplication : ne jamais clore deux fois le même openTime.
    if (hist.some((b) => b.openTime === bar.openTime)) return;

    // Détection d'aberration vs la dernière bougie saine.
    const ref = [...hist].reverse().find((b) => !b.outlier);
    if (ref) {
      const movePct = Math.abs((bar.close - ref.close) / ref.close) * 100;
      const limit = OUTLIER_MOVE_PCT[assetClass] ?? 10;
      if (movePct > limit) bar.outlier = true;
    }

    hist.push(bar);
    if (hist.length > HISTORY_KEEP) hist.splice(0, hist.length - HISTORY_KEEP);
    this.history.set(key, hist);
    this.onClose({ bar });
  }

  /**
   * Clôture forcée des bougies dont la période est terminée sans nouveau tick
   * (titres calmes / fin de session). À appeler périodiquement.
   */
  flushExpired(now: number, assetClassOf: (symbol: string) => string): void {
    for (const [key, bar] of this.building) {
      const tfMs = TF_MS[bar.tf];
      if (now >= bar.openTime + tfMs) {
        this.building.delete(key);
        this.close(key, bar, assetClassOf(bar.symbol));
      }
    }
  }

  /** Historique clos (openTime croissant), aberrations exclues par défaut. */
  getBars(symbol: string, tf: Timeframe, includeOutliers = false): Bar[] {
    const hist = this.history.get(this.key(symbol, tf)) ?? [];
    return includeOutliers ? [...hist] : hist.filter((b) => !b.outlier);
  }
}

/**
 * Agrège des bougies d'un timeframe source vers un timeframe supérieur
 * (H1 → H4/D1). Pur, sans état.
 *
 * ANTI-LOOKAHEAD — règle centrale : une bougie du timeframe supérieur n'est
 * émise que si sa période est ENTIÈREMENT terminée au regard de la dernière
 * bougie source close. Une bougie H4 en cours de formation n'apparaît donc
 * jamais dans le résultat et ne peut pas influencer un signal H1.
 *
 * Les périodes sont alignées sur l'epoch UTC (D1 = minuit UTC). Pour les
 * actions, une bougie « D1 » ne couvre que les heures de séance disponibles —
 * c'est la même information qu'un chart intraday agrégé, pas la bougie
 * officielle de l'exchange.
 */
export function aggregateHigherTf(bars: Bar[], target: Timeframe): Bar[] {
  if (bars.length === 0) return [];
  const targetMs = TF_MS[target];
  const sourceMs = TF_MS[bars[0].tf];
  if (targetMs <= sourceMs) return [];

  const sorted = [...bars].sort((a, b) => a.openTime - b.openTime);
  // Fin de la dernière période source close : borne anti-lookahead.
  const lastSourceClose = sorted[sorted.length - 1].openTime + sourceMs;

  const buckets = new Map<number, Bar>();
  for (const bar of sorted) {
    if (bar.outlier) continue;
    const openTime = Math.floor(bar.openTime / targetMs) * targetMs;
    const current = buckets.get(openTime);
    if (!current) {
      buckets.set(openTime, {
        symbol: bar.symbol,
        tf: target,
        openTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        ticks: bar.ticks,
      });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
    current.ticks += bar.ticks;
  }

  return [...buckets.values()]
    .filter((b) => b.openTime + targetMs <= lastSourceClose)
    .sort((a, b) => a.openTime - b.openTime);
}

function newBar(quote: Quote, tf: Timeframe, openTime: number, gapBefore: boolean): Bar {
  return {
    symbol: quote.symbol,
    tf,
    openTime,
    open: quote.last,
    high: quote.last,
    low: quote.last,
    close: quote.last,
    volume: quote.volume ?? 0,
    ticks: 1,
    ...(gapBefore ? { gapBefore: true } : {}),
  };
}
