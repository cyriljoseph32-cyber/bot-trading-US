import { describe, it, expect } from "vitest";
import { backtest } from "./backtest";
import type { Trade } from "./strategy";

function trade(entry: number, exit: number): Trade {
  return {
    entryIdx: 0,
    exitIdx: 1,
    entryPrice: entry,
    exitPrice: exit,
    pnlPct: (exit / entry - 1) * 100,
    reason: "objectif",
  };
}

const noCosts = { commissionPct: 0, slippagePct: 0 };

describe("backtest (sans frais)", () => {
  const trades = [trade(100, 110), trade(100, 95)]; // +10 %, -5 %

  it("compose le rendement total net", () => {
    const m = backtest(trades, noCosts);
    // 1 * 1.10 * 0.95 = 1.045 → +4.5 %
    expect(m.totalReturnPct).toBeCloseTo(4.5, 6);
    expect(m.finalEquity).toBeCloseTo(1.045, 6);
  });

  it("calcule win-rate, profit factor, espérance", () => {
    const m = backtest(trades, noCosts);
    expect(m.winRate).toBeCloseTo(0.5, 6);
    expect(m.profitFactor).toBeCloseTo(2, 6); // 0.10 / 0.05
    expect(m.expectancyPct).toBeCloseTo(2.5, 6); // moyenne(+10,-5)
  });

  it("calcule le drawdown max", () => {
    const m = backtest(trades, noCosts);
    // pic 1.10 puis 1.045 → dd = (1.10-1.045)/1.10 = 5 %
    expect(m.maxDrawdownPct).toBeCloseTo(5, 6);
  });

  it("Sharpe nul si un seul trade (écart-type indéfini)", () => {
    const m = backtest([trade(100, 110)], noCosts);
    expect(m.sharpe).toBeNull();
  });
});

describe("backtest (avec frais/slippage)", () => {
  it("réduit le rendement par le coût aller-retour", () => {
    const trades = [trade(100, 110)];
    const gross = backtest(trades, noCosts).totalReturnPct;
    const net = backtest(trades, { commissionPct: 0, slippagePct: 0.05 }).totalReturnPct;
    expect(net).toBeLessThan(gross);
    // coût aller-retour = 2 * 0.05 % = 0.1 %
    expect(gross - net).toBeCloseTo(0.1, 4);
  });

  it("profit factor null et drawdown 0 sans trades", () => {
    const m = backtest([], noCosts);
    expect(m.trades).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.maxDrawdownPct).toBe(0);
  });
});
