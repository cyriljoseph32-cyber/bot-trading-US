/* ─── Moteur SPC FX5 : le MÊME code en temps réel et en backtest ───────────
 *
 * Le runner (bot/src/spcfx5.ts) et le backtest (bot/src/spcfx5-backtest.ts)
 * partagent cette classe. C'est volontaire : un backtest qui n'exécute pas
 * exactement le code de production ne prouve rien.
 *
 * Cycle, à chaque clôture de bougie H1 :
 *   1. évaluer chaque symbole (signal.ts) sur ses bougies CLOSES ;
 *   2. classer les setups éligibles et arbitrer le portefeuille (ranking.ts) ;
 *   3. soumettre les entrées retenues au moteur de risque puis au routeur.
 *
 * Sur chaque cotation : valorisation, break-even/trailing, et vérification
 * des sorties — jamais bloquées.
 */

import { atr as atrSeries } from "../../../../src/trading/indicators";
import { aggregateHigherTf } from "../../bars";
import type { OrderResult, Quote, Bar } from "../../types";
import type { PaperBroker } from "../../exec/paper";
import type { OrderRouter } from "../../exec/router";
import type { RiskEngine } from "../../risk/engine";
import type { PortfolioGovernor } from "../../risk/portfolio";
import type { Store } from "../../store";
import { logger } from "../../log";
import { evaluateSpcFx5 } from "./signal";
import { rankAndSelect, type RankedSignal } from "./ranking";
import { manageStop } from "./manage";
import { groupBets, volatilityBandOf, type SpcConfig } from "./universe";
import { newsFilter, type NewsEvent } from "./filters";
import type { Direction, SpcParams } from "./params";
import type { SpcSignal, SpcUniverseEntry } from "./types";

const HISTORY_KEEP = 700; // bougies H1 conservées par symbole (~1 mois de FX)

/**
 * Cotation reconstituée à partir d'un prix de bougie. Le bid/ask est dérivé du
 * coût configuré de l'actif : c'est une ESTIMATION, jamais un spread réel —
 * le signal le signale via la note `spread_unknown`.
 */
export function syntheticQuote(
  entry: SpcUniverseEntry,
  price: number,
  costBps: number,
  ts: number,
  volume: number | null = null
): Quote {
  const half = (price * (costBps / 10_000)) / 2;
  return {
    symbol: entry.instrument.symbol,
    assetClass: entry.instrument.assetClass,
    exchange: entry.instrument.exchange,
    currency: entry.instrument.currency,
    bid: price - half,
    ask: price + half,
    last: price,
    volume,
    ts,
    stale: false,
    estimated: true,
  };
}

/** Métadonnées d'une position ouverte par la stratégie. */
interface PositionMeta {
  direction: Direction;
  entryPrice: number;
  /** Risque initial par unité — référence de tous les calculs en R. */
  initialRisk: number;
}

export interface SpcEngineDeps {
  config: SpcConfig;
  universe: SpcUniverseEntry[];
  params: SpcParams;
  broker: PaperBroker;
  router: OrderRouter;
  risk: RiskEngine;
  governor: PortfolioGovernor;
  store: Store;
  /** Annonces macro ; null = flux non connecté (filtre neutre). */
  news: NewsEvent[] | null;
}

export interface CycleResult {
  signals: SpcSignal[];
  ranked: RankedSignal[];
  submitted: OrderResult[];
}

export class SpcEngine {
  private bars = new Map<string, Bar[]>();
  private meta = new Map<string, PositionMeta>();
  private quotes = new Map<string, Quote>();
  private lastSignals = new Map<string, SpcSignal>();
  private lastRanked: RankedSignal[] = [];

  constructor(private readonly deps: SpcEngineDeps) {}

  /* ─── Données ──────────────────────────────────────────────────────── */

  /** Amorce ou complète l'historique H1 d'un symbole (dédupliqué par openTime). */
  seedBars(symbol: string, bars: Bar[]): void {
    const existing = this.bars.get(symbol) ?? [];
    const seen = new Set(existing.map((b) => b.openTime));
    for (const bar of bars) {
      if (bar.tf !== "1h" || seen.has(bar.openTime)) continue;
      existing.push(bar);
      seen.add(bar.openTime);
    }
    existing.sort((a, b) => a.openTime - b.openTime);
    if (existing.length > HISTORY_KEEP) existing.splice(0, existing.length - HISTORY_KEEP);
    this.bars.set(symbol, existing);
  }

  barsOf(symbol: string): Bar[] {
    return (this.bars.get(symbol) ?? []).filter((b) => !b.outlier);
  }

  signals(): SpcSignal[] {
    return [...this.lastSignals.values()];
  }

  ranked(): RankedSignal[] {
    return this.lastRanked;
  }

  /**
   * Ingestion d'une bougie H1 CLOSE : historique + rejeu du chemin
   * intra-bougie sous forme de cotations.
   *
   * En H1, on ne dispose pas du tick par tick. Rejouer open → extrême
   * DÉFAVORABLE → extrême favorable → close est le choix CONSERVATEUR : si le
   * stop et le take-profit sont tous deux dans la bougie, c'est le stop qui
   * part. Un backtest qui ferait l'inverse s'auto-flatterait.
   */
  ingestBar(entry: SpcUniverseEntry, bar: Bar, costBps: number): void {
    this.seedBars(entry.instrument.symbol, [bar]);

    const meta = this.meta.get(entry.instrument.symbol);
    const longBias = meta?.direction !== "short";
    const path = longBias
      ? [bar.open, bar.low, bar.high, bar.close]
      : [bar.open, bar.high, bar.low, bar.close];

    const closeTime = bar.openTime + 3_600_000;
    path.forEach((price, index) => {
      this.onQuote(syntheticQuote(entry, price, costBps, closeTime - path.length + index, bar.volume));
    });
  }

  /* ─── Cotations : valorisation, gestion de position, sorties ───────── */

  onQuote(quote: Quote): void {
    this.quotes.set(quote.symbol, quote);
    this.deps.broker.updateQuote(quote);
    this.manageOpenPosition(quote);

    // SORTIE : stop ou take-profit atteint. Jamais bloquée par le risque.
    const exit = this.deps.broker.checkExit(quote);
    if (!exit) return;
    const before = this.deps.broker.snapshot().realizedPnl;
    const result = this.deps.router.submit(exit, quote);
    this.deps.store.saveOrder(result);
    if (result.status === "filled") {
      const pnl = this.deps.broker.snapshot().realizedPnl - before;
      this.deps.governor.registerExit(quote.symbol, pnl, quote.ts);
      this.meta.delete(quote.symbol);
      logger.info("spcfx5", `sortie ${quote.symbol} — P&L réalisé ${pnl.toFixed(2)}`);
    }
  }

  /** Break-even puis trailing, appliqués au stop de la position ouverte. */
  private manageOpenPosition(quote: Quote): void {
    const position = this.deps.broker.position(quote.symbol);
    const meta = this.meta.get(quote.symbol);
    if (!position || !meta || position.stopLoss === undefined) return;

    const bars = this.barsOf(quote.symbol);
    const atrValue =
      bars.length > 0
        ? (atrSeries(
            bars.map((b) => b.high),
            bars.map((b) => b.low),
            bars.map((b) => b.close),
            this.deps.params.volatility.atrPeriod
          ).at(-1) ?? null)
        : null;

    const managed = manageStop({
      direction: meta.direction,
      entryPrice: meta.entryPrice,
      currentStop: position.stopLoss,
      initialRisk: meta.initialRisk,
      price: quote.last,
      atr: atrValue,
      params: this.deps.params.stop,
    });
    if (managed.newStop === null) return;
    if (this.deps.broker.updateStop(quote.symbol, managed.newStop)) {
      logger.info(
        "spcfx5",
        `${quote.symbol} stop déplacé à ${managed.newStop.toFixed(5)} — ${managed.reason}`
      );
    }
  }

  /* ─── Cycle H1 ─────────────────────────────────────────────────────── */

  /**
   * Évalue tout l'univers, classe les setups et exécute les entrées retenues.
   * `now` est l'instant de référence (clôture de la bougie H1 traitée).
   */
  runCycle(now: number): CycleResult {
    const { deps } = this;
    const snapshot = deps.broker.snapshot();
    deps.governor.rollTime(now, snapshot.equity);

    const evaluated: Array<{ signal: SpcSignal; asset: SpcUniverseEntry["asset"] }> = [];

    for (const entry of deps.universe) {
      const bars = this.barsOf(entry.instrument.symbol);
      if (bars.length === 0) continue;

      const signal = evaluateSpcFx5({
        asset: entry.asset,
        bars,
        // H4 et D1 dérivés des bougies H1 CLOSES : aucun lookahead possible.
        barsH4: aggregateHigherTf(bars, "4h"),
        barsD1: aggregateHigherTf(bars, "1d"),
        quote: this.quotes.get(entry.instrument.symbol) ?? null,
        news: deps.news,
        params: deps.params,
        volatilityBand: volatilityBandOf(entry.asset, deps.config),
      });

      this.lastSignals.set(entry.instrument.symbol, signal);
      deps.store.saveRecord("spcfx5-signals", signal);
      evaluated.push({ signal, asset: entry.asset });

      this.maybeCloseOnNews(entry, now);
    }

    const ranked = rankAndSelect({
      signals: evaluated,
      governor: deps.governor,
      equity: snapshot.equity,
      now,
      riskPctPerTrade: deps.risk.params.riskPctPerTrade,
    });
    this.lastRanked = ranked;

    const submitted: OrderResult[] = [];
    for (const candidate of ranked) {
      if (!candidate.selected) continue;
      const result = this.enter(candidate, now);
      if (result) submitted.push(result);
    }

    return { signals: evaluated.map((e) => e.signal), ranked, submitted };
  }

  /**
   * Fermeture sur annonce macro — désactivée par défaut. Une position ouverte
   * n'est PAS fermée par le filtre news sauf si `closePositionsOnNews` est
   * explicitement activé : subir le spread d'une annonce est souvent pire que
   * laisser le stop faire son travail.
   */
  private maybeCloseOnNews(entry: SpcUniverseEntry, now: number): void {
    const params = this.deps.params.news;
    if (!params.enabled || !params.closePositionsOnNews) return;
    const position = this.deps.broker.position(entry.instrument.symbol);
    if (!position) return;
    const verdict = newsFilter(entry.asset, now, this.deps.news, params);
    if (verdict.pass) return;

    const quote = this.quotes.get(entry.instrument.symbol);
    if (!quote) return;
    const before = this.deps.broker.snapshot().realizedPnl;
    const result = this.deps.router.submit(
      {
        clientOrderId: `spc-news-exit-${entry.instrument.symbol}-${now}`,
        symbol: entry.instrument.symbol,
        side: position.qty > 0 ? "sell" : "buy",
        qty: Math.abs(position.qty),
      },
      quote
    );
    this.deps.store.saveOrder(result);
    if (result.status === "filled") {
      const pnl = this.deps.broker.snapshot().realizedPnl - before;
      this.deps.governor.registerExit(entry.instrument.symbol, pnl, now);
      this.meta.delete(entry.instrument.symbol);
      logger.warn("spcfx5", `${entry.instrument.symbol} fermé sur annonce macro (${verdict.detail})`);
    }
  }

  /** Soumet une entrée retenue : moteur de risque, puis routeur. */
  private enter(candidate: RankedSignal, now: number): OrderResult | null {
    const { deps } = this;
    const { signal, asset } = candidate;
    const symbol = signal.symbol;
    const instrument = deps.universe.find((u) => u.instrument.symbol === symbol)?.instrument;
    if (!instrument) return null;

    // Une cotation est indispensable : pas de prix fiable, pas d'ordre.
    const quote = this.quotes.get(symbol);
    if (!quote) {
      logger.info("spcfx5", `${symbol} entrée abandonnée : aucune cotation disponible`);
      return null;
    }
    if (signal.stopLoss === null || signal.takeProfit === null || signal.riskPerUnit === null) {
      return null;
    }

    const side = signal.side === "long" ? "buy" : "sell";
    const decision = deps.risk.evaluateEntry({
      instrument,
      quote,
      atr: signal.atr,
      side,
      portfolio: deps.broker.snapshot(),
      fxToBase: deps.broker.fxToBase,
      stopLossOverride: signal.stopLoss,
      takeProfitOverride: signal.takeProfit,
      riskMultiplier: candidate.decision.sizeMultiplier,
    });
    if (!decision.approved) {
      logger.info("spcfx5", `${symbol} entrée refusée par le risque : ${decision.rejects.join(", ")}`);
      return null;
    }

    const order = deps.risk.buildOrder(`spc-${symbol}-${signal.ts}`, symbol, side, decision);
    const result = deps.router.submit(order, quote);
    deps.store.saveOrder(result);

    if (result.status === "rejected") {
      deps.risk.recordFailure();
      return result;
    }
    deps.risk.recordSuccess();
    if (result.status !== "filled") return result;

    const direction = signal.side as Direction;
    this.meta.set(symbol, {
      direction,
      entryPrice: result.fillPrice ?? signal.price,
      initialRisk: signal.riskPerUnit,
    });
    deps.governor.registerEntry({
      symbol,
      category: signal.category,
      direction,
      riskPct: candidate.riskPct,
      score: signal.score,
      groups: groupBets(asset, direction),
      openedAt: now,
    });
    logger.info(
      "spcfx5",
      `entrée ${direction} ${symbol} score ${signal.score} · stop ${signal.stopLoss} · TP ${signal.takeProfit}` +
        (candidate.decision.sizeMultiplier < 1
          ? ` · taille réduite ×${candidate.decision.sizeMultiplier}`
          : "")
    );
    return result;
  }
}
