/* ─── Moteur de risque global (pur, testable) ──────────────────────────────
 *
 * Vérifié AVANT CHAQUE ordre, papier comme réel. Même principe fondamental
 * que src/trading/risk.ts : les ENTRÉES peuvent être bloquées, les SORTIES
 * (réduction de risque) ne le sont jamais.
 *
 * Contrôles : taille max de position, expositions par pays/devise/secteur,
 * perte quotidienne max, stop/take-profit obligatoires, sizing par
 * volatilité (ATR), plafond de spread, kill switch, disjoncteur.
 */

import type { Instrument, OrderRequest, PortfolioSnapshot, Position, Quote } from "../types";

export interface GlobalRiskParams {
  /** % de l'equity risqué entre entrée et stop, par trade. */
  riskPctPerTrade: number;
  /** Taille max d'une position en % de l'equity. */
  maxPositionPct: number;
  /** Exposition brute max totale en % de l'equity. */
  maxGrossExposurePct: number;
  /** Exposition max par pays en % de l'equity. */
  maxCountryExposurePct: number;
  /** Exposition max par devise (hors devise de base) en % de l'equity. */
  maxCurrencyExposurePct: number;
  /** Exposition max par secteur en % de l'equity. */
  maxSectorExposurePct: number;
  /** Halte des entrées si la perte du jour atteint ce % de l'equity. */
  maxDailyLossPct: number;
  /** Spread max toléré à l'exécution, en points de base. */
  maxSpreadBps: number;
  /** Distance de stop par défaut en multiples d'ATR. */
  atrStopMult: number;
  /** Ratio take-profit / stop (R multiple). */
  takeProfitR: number;
  /** Arrêt d'urgence : aucune nouvelle entrée. */
  killSwitch: boolean;
  /** Disjoncteur : nb de rejets/erreurs consécutifs avant halte automatique. */
  circuitBreakerThreshold: number;
}

export const DEFAULT_GLOBAL_RISK: GlobalRiskParams = {
  riskPctPerTrade: 0.5,
  maxPositionPct: 10,
  maxGrossExposurePct: 60,
  maxCountryExposurePct: 25,
  maxCurrencyExposurePct: 30,
  maxSectorExposurePct: 25,
  maxDailyLossPct: 2,
  maxSpreadBps: 30,
  atrStopMult: 2,
  takeProfitR: 2,
  killSwitch: false,
  circuitBreakerThreshold: 5,
};

export type RiskReject =
  | "kill_switch"
  | "circuit_breaker"
  | "daily_loss"
  | "stale_quote"
  | "spread_too_wide"
  | "stop_invalid"
  | "position_too_large"
  | "gross_exposure"
  | "country_exposure"
  | "currency_exposure"
  | "sector_exposure"
  | "insufficient_capital";

export interface RiskDecision {
  approved: boolean;
  /** Quantité éventuellement réduite pour respecter les plafonds. */
  qty: number;
  stopLoss?: number;
  takeProfit?: number;
  rejects: RiskReject[];
}

export interface EntryContext {
  instrument: Instrument;
  quote: Quote;
  /** ATR de la dernière bougie (devise de cotation). */
  atr: number | null;
  side: "buy" | "sell";
  portfolio: PortfolioSnapshot;
  /** Conversion devise de cotation → devise de base (1 unité → base). */
  fxToBase: (currency: string, amount: number) => number | null;
}

/** Exposition en devise de base d'un ensemble de positions filtrées. */
function exposure(
  positions: Position[],
  fxToBase: EntryContext["fxToBase"],
  filter: (p: Position) => boolean
): number {
  let total = 0;
  for (const p of positions) {
    if (!filter(p)) continue;
    const value = fxToBase(p.currency, Math.abs(p.qty) * p.avgEntryPrice);
    if (value !== null) total += value;
  }
  return total;
}

export class RiskEngine {
  private consecutiveFailures = 0;
  private circuitOpen = false;

  constructor(public params: GlobalRiskParams) {}

  /** À appeler sur chaque erreur d'exécution/flux ; déclenche le disjoncteur. */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.params.circuitBreakerThreshold) {
      this.circuitOpen = true;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** Réarme le disjoncteur (action explicite via l'API). */
  resetCircuit(): void {
    this.circuitOpen = false;
    this.consecutiveFailures = 0;
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /** Perte du jour en % (positif = perte). */
  dailyLossPct(portfolio: PortfolioSnapshot): number {
    if (!(portfolio.dayStartEquity > 0)) return 0;
    return ((portfolio.dayStartEquity - portfolio.equity) / portfolio.dayStartEquity) * 100;
  }

  /**
   * Évalue une ENTRÉE. Renvoie la quantité autorisée (éventuellement réduite),
   * le stop et le take-profit à attacher, et les raisons de rejet sinon.
   */
  evaluateEntry(ctx: EntryContext): RiskDecision {
    const rejects: RiskReject[] = [];
    const p = this.params;
    const { quote, instrument, portfolio } = ctx;

    if (p.killSwitch) rejects.push("kill_switch");
    if (this.circuitOpen) rejects.push("circuit_breaker");
    if (this.dailyLossPct(portfolio) >= p.maxDailyLossPct) rejects.push("daily_loss");
    if (quote.stale) rejects.push("stale_quote");

    // Spread : gate de qualité d'exécution.
    if (quote.bid !== null && quote.ask !== null && quote.bid > 0) {
      const mid = (quote.bid + quote.ask) / 2;
      const bps = ((quote.ask - quote.bid) / mid) * 10_000;
      if (bps > p.maxSpreadBps) rejects.push("spread_too_wide");
    }

    // Stop par volatilité : impossible de dimensionner sans ATR valide.
    const price = quote.last;
    const atrValue = ctx.atr;
    if (atrValue === null || !(atrValue > 0) || !(price > 0)) {
      rejects.push("stop_invalid");
      return { approved: false, qty: 0, rejects };
    }
    const stopDistance = atrValue * p.atrStopMult;
    const stopLoss = ctx.side === "buy" ? price - stopDistance : price + stopDistance;
    const takeProfit =
      ctx.side === "buy"
        ? price + stopDistance * p.takeProfitR
        : price - stopDistance * p.takeProfitR;
    if (stopLoss <= 0) {
      rejects.push("stop_invalid");
      return { approved: false, qty: 0, rejects };
    }

    if (rejects.length > 0) return { approved: false, qty: 0, rejects };

    // Sizing par volatilité : risque fixe en % de l'equity entre entrée et stop.
    const equity = portfolio.equity;
    const riskBudgetBase = equity * (p.riskPctPerTrade / 100);
    const stopDistanceBase = ctx.fxToBase(instrument.currency, stopDistance);
    const priceBase = ctx.fxToBase(instrument.currency, price);
    if (stopDistanceBase === null || priceBase === null || stopDistanceBase <= 0) {
      return { approved: false, qty: 0, rejects: ["stop_invalid"] };
    }
    let qty = Math.floor(riskBudgetBase / stopDistanceBase);

    // Plafond de taille de position.
    const maxPositionValue = equity * (p.maxPositionPct / 100);
    qty = Math.min(qty, Math.floor(maxPositionValue / priceBase));

    // Plafonds d'exposition : brute, pays, devise, secteur.
    const positions = portfolio.positions;
    const gross = exposure(positions, ctx.fxToBase, () => true);
    const country = exposure(positions, ctx.fxToBase, (x) => x.country === instrument.country);
    const currency = exposure(positions, ctx.fxToBase, (x) => x.currency === instrument.currency);
    const sector = exposure(
      positions,
      ctx.fxToBase,
      (x) => x.sector !== undefined && x.sector === instrument.sector
    );

    const capBy = (used: number, capPct: number): number =>
      Math.max(0, equity * (capPct / 100) - used);

    let headroom = capBy(gross, p.maxGrossExposurePct);
    if (headroom <= 0) rejects.push("gross_exposure");

    const countryRoom = capBy(country, p.maxCountryExposurePct);
    if (countryRoom <= 0) rejects.push("country_exposure");
    headroom = Math.min(headroom, countryRoom);

    if (instrument.currency !== portfolio.baseCurrency) {
      const ccyRoom = capBy(currency, p.maxCurrencyExposurePct);
      if (ccyRoom <= 0) rejects.push("currency_exposure");
      headroom = Math.min(headroom, ccyRoom);
    }

    if (instrument.sector) {
      const sectorRoom = capBy(sector, p.maxSectorExposurePct);
      if (sectorRoom <= 0) rejects.push("sector_exposure");
      headroom = Math.min(headroom, sectorRoom);
    }

    if (rejects.length > 0) return { approved: false, qty: 0, rejects };

    qty = Math.min(qty, Math.floor(headroom / priceBase));

    if (qty < 1) {
      return { approved: false, qty: 0, rejects: ["insufficient_capital"] };
    }

    return {
      approved: true,
      qty,
      stopLoss: round4(stopLoss),
      takeProfit: round4(takeProfit),
      rejects: [],
    };
  }

  /** Les sorties ne sont JAMAIS bloquées — fermer réduit le risque. */
  evaluateExit(): RiskDecision {
    return { approved: true, qty: 0, rejects: [] };
  }

  buildOrder(
    clientOrderId: string,
    symbol: string,
    side: "buy" | "sell",
    decision: RiskDecision
  ): OrderRequest {
    return {
      clientOrderId,
      symbol,
      side,
      qty: decision.qty,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
    };
  }
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
