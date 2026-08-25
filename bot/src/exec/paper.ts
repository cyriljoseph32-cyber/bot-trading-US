/* ─── Courtier papier (simulation, pur, testable) ──────────────────────────
 *
 *   • idempotence : un même clientOrderId ne produit qu'un seul ordre — le
 *     rejouer renvoie le résultat d'origine avec le statut "duplicate" ;
 *   • exécution au bid/ask (à défaut au last) ± slippage paramétré ;
 *   • P&L réalisé/latent converti en devise de base via les cotations FX
 *     du flux (mise à jour par updateFxRate) ;
 *   • frais fixes en points de base par transaction.
 */

import type {
  Instrument,
  OrderRequest,
  OrderResult,
  PortfolioSnapshot,
  Position,
  Quote,
} from "../types";
import type { BrokerAdapter } from "./broker";

export interface PaperCosts {
  /** Frais par transaction, en points de base du notionnel. */
  feeBps: number;
  /** Slippage simulé, en points de base (défavorable). */
  slippageBps: number;
}

export const DEFAULT_PAPER_COSTS: PaperCosts = { feeBps: 5, slippageBps: 5 };

export class PaperBroker implements BrokerAdapter {
  readonly name = "paper";
  readonly isLive = false;

  private cash: number;
  private dayStartEquity: number;
  private realizedPnl = 0;
  private positions = new Map<string, Position>();
  private orderLog = new Map<string, OrderResult>(); // idempotence
  private lastQuotes = new Map<string, Quote>();
  /** Taux devise → base : 1 unité de `ccy` vaut `rate` en devise de base. */
  private fxRates = new Map<string, number>();
  private instruments = new Map<string, Instrument>();

  constructor(
    initialCapital: number,
    private readonly baseCurrency: string,
    private readonly costs: PaperCosts = DEFAULT_PAPER_COSTS
  ) {
    this.cash = initialCapital;
    this.dayStartEquity = initialCapital;
    this.fxRates.set(baseCurrency, 1);
  }

  registerInstruments(instruments: Instrument[]): void {
    for (const inst of instruments) this.instruments.set(inst.symbol, inst);
  }

  /** Met à jour un taux de conversion vers la devise de base. */
  updateFxRate(currency: string, rate: number): void {
    if (rate > 0) this.fxRates.set(currency.toUpperCase(), rate);
  }

  /** Alimente les derniers prix (valorisation du portefeuille). */
  updateQuote(quote: Quote): void {
    this.lastQuotes.set(quote.symbol, quote);
  }

  /** Conversion devise → base (null si taux inconnu : on refuse de deviner). */
  fxToBase = (currency: string, amount: number): number | null => {
    const rate = this.fxRates.get(currency.toUpperCase());
    return rate !== undefined ? amount * rate : null;
  };

  /** À appeler au passage de minuit UTC : base du P&L quotidien. */
  rollDay(): void {
    this.dayStartEquity = this.snapshot().equity;
  }

  submit(order: OrderRequest, quote: Quote): OrderResult {
    // Idempotence : même clientOrderId → même résultat, aucun double ordre.
    const existing = this.orderLog.get(order.clientOrderId);
    if (existing) return { ...existing, status: "duplicate" };

    const reject = (reason: string): OrderResult => {
      const res: OrderResult = {
        clientOrderId: order.clientOrderId,
        status: "rejected",
        reason,
        ts: Date.now(),
      };
      this.orderLog.set(order.clientOrderId, res);
      return res;
    };

    if (!(order.qty > 0)) return reject("qty_invalid");
    if (quote.stale) return reject("stale_quote");

    // Prix d'exécution : côté défavorable + slippage.
    const slip = this.costs.slippageBps / 10_000;
    const refPrice =
      order.side === "buy" ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last);
    const fillPrice = order.side === "buy" ? refPrice * (1 + slip) : refPrice * (1 - slip);

    const inst = this.instruments.get(order.symbol);
    const currency = inst?.currency ?? quote.currency;
    const notionalBase = this.fxToBase(currency, fillPrice * order.qty);
    if (notionalBase === null) return reject("fx_rate_unknown");
    const fee = notionalBase * (this.costs.feeBps / 10_000);

    const pos = this.positions.get(order.symbol);
    const signedQty = order.side === "buy" ? order.qty : -order.qty;

    if (!pos) {
      // Ouverture : le cash doit couvrir le notionnel (pas de levier en papier).
      if (order.side === "buy" && notionalBase + fee > this.cash) {
        return reject("insufficient_cash");
      }
      this.positions.set(order.symbol, {
        symbol: order.symbol,
        assetClass: inst?.assetClass ?? quote.assetClass,
        currency,
        country: inst?.country ?? "XX",
        sector: inst?.sector,
        qty: signedQty,
        avgEntryPrice: fillPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        openedAt: Date.now(),
      });
      this.cash -= order.side === "buy" ? notionalBase + fee : -(notionalBase - fee);
    } else {
      const newQty = pos.qty + signedQty;
      if (Math.sign(newQty) === Math.sign(pos.qty) && Math.abs(newQty) > Math.abs(pos.qty)) {
        // Renforcement : moyenne pondérée.
        const totalCost = pos.avgEntryPrice * Math.abs(pos.qty) + fillPrice * order.qty;
        pos.avgEntryPrice = totalCost / Math.abs(newQty);
        pos.qty = newQty;
        this.cash -= order.side === "buy" ? notionalBase + fee : -(notionalBase - fee);
      } else {
        // Réduction/clôture : P&L réalisé sur la part fermée.
        const closedQty = Math.min(order.qty, Math.abs(pos.qty));
        const pnlPerUnit =
          pos.qty > 0 ? fillPrice - pos.avgEntryPrice : pos.avgEntryPrice - fillPrice;
        const pnlBase = this.fxToBase(currency, pnlPerUnit * closedQty);
        if (pnlBase === null) return reject("fx_rate_unknown");
        this.realizedPnl += pnlBase - fee;
        const entryBase = this.fxToBase(currency, pos.avgEntryPrice * closedQty) ?? 0;
        this.cash += entryBase + pnlBase - fee;
        pos.qty = newQty;
        if (pos.qty === 0) this.positions.delete(order.symbol);
      }
    }

    const res: OrderResult = {
      clientOrderId: order.clientOrderId,
      status: "filled",
      fillPrice: round4(fillPrice),
      qty: order.qty,
      ts: Date.now(),
    };
    this.orderLog.set(order.clientOrderId, res);
    return res;
  }

  /** Position ouverte sur ce symbole, ou null. */
  position(symbol: string): Position | null {
    return this.positions.get(symbol) ?? null;
  }

  /**
   * Déplace le stop d'une position ouverte (break-even, trailing).
   *
   * Le stop ne peut QUE se resserrer : jamais s'éloigner du prix. Un stop qui
   * recule augmenterait le risque d'une position déjà engagée — exactement ce
   * qu'un trailing stop est censé empêcher.
   */
  updateStop(symbol: string, newStop: number): boolean {
    const pos = this.positions.get(symbol);
    if (!pos || !(newStop > 0)) return false;
    const isLong = pos.qty > 0;
    if (pos.stopLoss !== undefined) {
      if (isLong && newStop <= pos.stopLoss) return false;
      if (!isLong && newStop >= pos.stopLoss) return false;
    }
    pos.stopLoss = newStop;
    return true;
  }

  /** Vérifie stops/take-profits sur une cotation ; renvoie l'ordre de sortie éventuel. */
  checkExit(quote: Quote): OrderRequest | null {
    const pos = this.positions.get(quote.symbol);
    if (!pos) return null;
    const price = quote.last;
    const isLong = pos.qty > 0;
    const stopHit =
      pos.stopLoss !== undefined && (isLong ? price <= pos.stopLoss : price >= pos.stopLoss);
    const tpHit =
      pos.takeProfit !== undefined &&
      (isLong ? price >= pos.takeProfit : price <= pos.takeProfit);
    if (!stopHit && !tpHit) return null;
    return {
      clientOrderId: `exit-${pos.symbol}-${pos.openedAt}-${stopHit ? "sl" : "tp"}`,
      symbol: pos.symbol,
      side: isLong ? "sell" : "buy",
      qty: Math.abs(pos.qty),
    };
  }

  snapshot(): PortfolioSnapshot {
    let unrealized = 0;
    let positionsValue = 0;
    const positions = [...this.positions.values()];
    for (const pos of positions) {
      const quote = this.lastQuotes.get(pos.symbol);
      const price = quote?.last ?? pos.avgEntryPrice;
      const pnlPerUnit =
        pos.qty > 0 ? price - pos.avgEntryPrice : pos.avgEntryPrice - price;
      const pnlBase = this.fxToBase(pos.currency, pnlPerUnit * Math.abs(pos.qty));
      const valueBase = this.fxToBase(pos.currency, pos.avgEntryPrice * Math.abs(pos.qty));
      if (pnlBase !== null) unrealized += pnlBase;
      if (valueBase !== null) positionsValue += valueBase;
    }
    return {
      baseCurrency: this.baseCurrency,
      equity: round2(this.cash + positionsValue + unrealized),
      cash: round2(this.cash),
      dayStartEquity: round2(this.dayStartEquity),
      realizedPnl: round2(this.realizedPnl),
      unrealizedPnl: round2(unrealized),
      positions,
    };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
