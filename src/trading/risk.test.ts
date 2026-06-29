import { describe, it, expect } from "vitest";
import {
  DEFAULT_RISK,
  dailyLossPct,
  entriesHalted,
  evaluateEntry,
  type RiskParams,
  type RiskState,
} from "./risk";

const baseState: RiskState = {
  equity: 10000,
  lastEquity: 10000,
  openPositions: 0,
  tradesToday: 0,
};

function params(over: Partial<RiskParams> = {}): RiskParams {
  return { ...DEFAULT_RISK, ...over };
}

describe("dailyLossPct", () => {
  it("perte = (lastEquity - equity) / lastEquity", () => {
    expect(dailyLossPct({ ...baseState, equity: 9700 })).toBeCloseTo(3, 6);
  });
  it("gain → valeur négative", () => {
    expect(dailyLossPct({ ...baseState, equity: 10200 })).toBeCloseTo(-2, 6);
  });
  it("lastEquity nul → 0 (pas de division par zéro)", () => {
    expect(dailyLossPct({ ...baseState, lastEquity: 0 })).toBe(0);
  });
});

describe("entriesHalted (niveau portefeuille)", () => {
  it("kill switch → entrées bloquées", () => {
    const h = entriesHalted(params({ killSwitch: true }), baseState);
    expect(h.halted).toBe(true);
    expect(h.reason).toBe("kill_switch");
  });
  it("perte du jour ≥ limite → entrées bloquées", () => {
    const h = entriesHalted(params({ maxDailyLossPct: 3 }), { ...baseState, equity: 9600 });
    expect(h.halted).toBe(true);
    expect(h.reason).toBe("perte_quotidienne");
  });
  it("journée normale → entrées autorisées", () => {
    expect(entriesHalted(params(), baseState).halted).toBe(false);
  });
});

describe("evaluateEntry", () => {
  it("approuve avec la taille calculée par le risque", () => {
    const d = evaluateEntry({ symbol: "AAPL", entry: 100, stop: 95 }, params(), baseState);
    expect(d.approved).toBe(true);
    expect(d.qty).toBe(20); // risque 1% de 10000 / 5 = 20
  });

  it("plafonne par la concentration maximale", () => {
    // risque/action = 1 → sizing = 100 actions, mais plafond 5% de 10000 / 100 = 5
    const d = evaluateEntry(
      { symbol: "KO", entry: 100, stop: 99 },
      params({ maxPositionPct: 5 }),
      baseState
    );
    expect(d.approved).toBe(true);
    expect(d.qty).toBe(5);
  });

  it("refuse si le nombre max de positions est atteint", () => {
    const d = evaluateEntry(
      { symbol: "MSFT", entry: 100, stop: 95 },
      params({ maxOpenPositions: 5 }),
      { ...baseState, openPositions: 5 }
    );
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("max_positions");
  });

  it("refuse au-delà du quota de trades du jour", () => {
    const d = evaluateEntry(
      { symbol: "NVDA", entry: 100, stop: 95 },
      params({ maxTradesPerDay: 3 }),
      { ...baseState, tradesToday: 3 }
    );
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("max_trades");
  });

  it("refuse en kill switch (priorité absolue)", () => {
    const d = evaluateEntry({ symbol: "TSLA", entry: 100, stop: 95 }, params({ killSwitch: true }), baseState);
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("kill_switch");
  });

  it("refuse si la perte du jour dépasse la limite", () => {
    const d = evaluateEntry(
      { symbol: "META", entry: 100, stop: 95 },
      params({ maxDailyLossPct: 3 }),
      { ...baseState, equity: 9600 }
    );
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("perte_quotidienne");
  });

  it("refuse un stop invalide (≥ entrée)", () => {
    const d = evaluateEntry({ symbol: "V", entry: 100, stop: 100 }, params(), baseState);
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("stop_invalide");
  });

  it("refuse si le capital ne permet pas 1 action", () => {
    const d = evaluateEntry(
      { symbol: "BRK.A", entry: 600000, stop: 590000 },
      params(),
      { ...baseState, equity: 1000, lastEquity: 1000 }
    );
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("capital_insuffisant");
  });

  it("ne risque jamais plus que le budget par trade", () => {
    const p = params();
    const d = evaluateEntry({ symbol: "HD", entry: 100, stop: 95 }, p, baseState);
    const riskTaken = d.qty * (100 - 95);
    expect(riskTaken).toBeLessThanOrEqual((baseState.equity * p.riskPct) / 100);
  });
});


describe("plafond d'exposition brute (fix #5)", () => {
  const params = { ...DEFAULT_RISK, maxGrossExposurePct: 70 };
  it("refuse quand l'exposition brute est saturée", () => {
    const state = { equity: 10000, lastEquity: 10000, openPositions: 1, tradesToday: 0, investedValue: 6990 };
    const d = evaluateEntry({ symbol: "Y", entry: 100, stop: 95 }, params, state);
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("exposition_max");
  });
  it("autorise et plafonne la taille selon la marge d'exposition", () => {
    const state = { equity: 10000, lastEquity: 10000, openPositions: 1, tradesToday: 0, investedValue: 0 };
    const d = evaluateEntry({ symbol: "Y", entry: 100, stop: 95 }, params, state);
    expect(d.approved).toBe(true);
    expect(d.qty).toBeLessThanOrEqual(70);
  });
});
