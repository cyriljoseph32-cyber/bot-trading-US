import { describe, it, expect } from "vitest";
import {
  PortfolioGovernor,
  DEFAULT_SPC_PORTFOLIO,
  weekKey,
  type EntryCandidate,
  type SpcPortfolioParams,
  type TrackedEntry,
} from "../src/risk/portfolio";
import { manageStop } from "../src/strategy/spcfx5/manage";
import { DEFAULT_SPC_PARAMS } from "../src/strategy/spcfx5/params";

const EQUITY = 100_000;
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0); // lundi

function params(over: Partial<SpcPortfolioParams> = {}): SpcPortfolioParams {
  return { ...DEFAULT_SPC_PORTFOLIO, ...over };
}

function candidate(over: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    symbol: "EUR/USD",
    category: "fx_major",
    direction: "long",
    riskPct: 0.5,
    score: 80,
    groups: [{ group: "usd", direction: "short" }],
    ...over,
  };
}

function tracked(over: Partial<TrackedEntry> = {}): TrackedEntry {
  return {
    symbol: "GBP/USD",
    category: "fx_major",
    direction: "long",
    riskPct: 0.5,
    score: 75,
    groups: [{ group: "usd", direction: "short" }],
    openedAt: NOW,
    ...over,
  };
}

describe("PortfolioGovernor — plafonds de positions", () => {
  it("accepte une entrée quand tous les plafonds sont respectés", () => {
    const g = new PortfolioGovernor(params(), EQUITY, NOW);
    const decision = g.evaluate(candidate(), EQUITY, NOW);
    expect(decision.allow).toBe(true);
    expect(decision.sizeMultiplier).toBe(1);
  });

  it("bloque au-delà du nombre maximum de positions ouvertes", () => {
    const g = new PortfolioGovernor(params({ maxOpenPositions: 1, maxPositionsPerCategory: 9 }), EQUITY, NOW);
    g.registerEntry(tracked({ symbol: "USD/JPY", category: "index" }));
    expect(g.evaluate(candidate(), EQUITY, NOW).rejects).toContain("max_open_positions");
  });

  it("bloque au-delà du nombre maximum par catégorie", () => {
    const g = new PortfolioGovernor(params({ maxPositionsPerCategory: 1 }), EQUITY, NOW);
    g.registerEntry(tracked({ groups: [] }));
    expect(g.evaluate(candidate({ groups: [] }), EQUITY, NOW).rejects).toContain(
      "max_positions_per_category"
    );
  });

  it("bloque au-delà du risque ouvert cumulé", () => {
    const g = new PortfolioGovernor(params({ maxTotalOpenRiskPct: 0.6 }), EQUITY, NOW);
    g.registerEntry(tracked({ groups: [] }));
    expect(g.evaluate(candidate({ groups: [] }), EQUITY, NOW).rejects).toContain("total_open_risk");
  });

  it("bloque au-delà du budget de risque du jour", () => {
    const g = new PortfolioGovernor(params({ maxDailyRiskPct: 0.6 }), EQUITY, NOW);
    g.registerEntry(tracked({ groups: [] }));
    expect(g.evaluate(candidate({ groups: [] }), EQUITY, NOW).rejects).toContain("daily_risk_budget");
  });

  it("bloque au-delà du nombre d'entrées quotidiennes", () => {
    const g = new PortfolioGovernor(
      params({ maxNewEntriesPerDay: 1, maxTotalOpenRiskPct: 99, maxDailyRiskPct: 99 }),
      EQUITY,
      NOW
    );
    g.registerEntry(tracked({ groups: [] }));
    expect(g.evaluate(candidate({ groups: [] }), EQUITY, NOW).rejects).toContain(
      "max_entries_per_day"
    );
  });
});

describe("PortfolioGovernor — pertes, cooldown et interdits durs", () => {
  it("arrête les entrées à la perte quotidienne maximale", () => {
    const g = new PortfolioGovernor(params({ maxDailyLossPct: 2 }), EQUITY, NOW);
    expect(g.evaluate(candidate(), EQUITY * 0.97, NOW).rejects).toContain("daily_loss_limit");
  });

  it("arrête les entrées à la perte hebdomadaire maximale", () => {
    const g = new PortfolioGovernor(params({ maxDailyLossPct: 99, maxWeeklyLossPct: 5 }), EQUITY, NOW);
    expect(g.evaluate(candidate(), EQUITY * 0.93, NOW).rejects).toContain("weekly_loss_limit");
  });

  it("déclenche le cooldown après N pertes consécutives, et le lève ensuite", () => {
    const g = new PortfolioGovernor(params({ cooldownAfterLosses: 2, cooldownMinutes: 60 }), EQUITY, NOW);
    g.registerExit("A", -100, NOW);
    expect(g.isInCooldown(NOW)).toBe(false);
    g.registerExit("B", -100, NOW);
    expect(g.isInCooldown(NOW)).toBe(true);
    expect(g.evaluate(candidate(), EQUITY, NOW).rejects).toContain("cooldown_active");
    expect(g.isInCooldown(NOW + 61 * 60_000)).toBe(false);
  });

  it("un gain remet la série de pertes à zéro", () => {
    const g = new PortfolioGovernor(params({ cooldownAfterLosses: 2 }), EQUITY, NOW);
    g.registerExit("A", -100, NOW);
    g.registerExit("B", +50, NOW);
    g.registerExit("C", -100, NOW);
    expect(g.isInCooldown(NOW)).toBe(false);
  });

  it("INTERDIT DUR : jamais de renforcement dans le sens d'une position ouverte", () => {
    const g = new PortfolioGovernor(params(), EQUITY, NOW);
    g.registerEntry(tracked({ symbol: "EUR/USD", direction: "long" }));
    const decision = g.evaluate(candidate({ direction: "long" }), EQUITY, NOW);
    expect(decision.rejects).toEqual(["averaging_down"]);
    expect(decision.sizeMultiplier).toBe(0);
  });

  it("INTERDIT DUR : pas d'inversion tant que la position est ouverte", () => {
    const g = new PortfolioGovernor(params(), EQUITY, NOW);
    g.registerEntry(tracked({ symbol: "EUR/USD", direction: "long" }));
    expect(g.evaluate(candidate({ direction: "short" }), EQUITY, NOW).rejects).toEqual([
      "already_open",
    ]);
  });

  it("PAS DE MARTINGALE : la taille demandée ne dépend jamais des pertes passées", () => {
    const g = new PortfolioGovernor(params({ cooldownAfterLosses: 0 }), EQUITY, NOW);
    const before = g.evaluate(candidate(), EQUITY, NOW).sizeMultiplier;
    g.registerExit("A", -500, NOW);
    g.registerExit("B", -500, NOW);
    g.registerExit("C", -500, NOW);
    expect(g.evaluate(candidate(), EQUITY, NOW).sizeMultiplier).toBe(before);
  });
});

describe("PortfolioGovernor — corrélation", () => {
  it("additionne le risque de deux paris identiques exprimés différemment", () => {
    // Long EURUSD et short USDCHF sont tous deux un pari « USD baisse ».
    const g = new PortfolioGovernor(params({ correlationGroupMaxRiskPct: 0.75 }), EQUITY, NOW);
    g.registerEntry(tracked({ symbol: "USD/CHF", groups: [{ group: "usd", direction: "short" }] }));
    const decision = g.evaluate(candidate({ score: 80 }), EQUITY, NOW);
    expect(decision.rejects).toContain("correlation_group_cap");
  });

  it("n'additionne pas deux paris de sens opposés sur le même groupe", () => {
    const g = new PortfolioGovernor(params({ correlationGroupMaxRiskPct: 0.75 }), EQUITY, NOW);
    g.registerEntry(tracked({ symbol: "USD/JPY", groups: [{ group: "usd", direction: "long" }] }));
    expect(g.evaluate(candidate(), EQUITY, NOW).allow).toBe(true);
  });

  it("accorde une exception, en taille réduite, à un score nettement supérieur", () => {
    const g = new PortfolioGovernor(
      params({
        correlationGroupMaxRiskPct: 0.75,
        correlationOverrideScoreDelta: 10,
        correlationOverrideSizeMult: 0.5,
      }),
      EQUITY,
      NOW
    );
    g.registerEntry(tracked({ symbol: "GBP/USD", score: 75 }));
    const decision = g.evaluate(candidate({ score: 90 }), EQUITY, NOW);
    expect(decision.allow).toBe(true);
    expect(decision.sizeMultiplier).toBe(0.5);
  });

  it("refuse l'exception si l'écart de score est insuffisant", () => {
    const g = new PortfolioGovernor(
      params({ correlationGroupMaxRiskPct: 0.75, correlationOverrideScoreDelta: 10 }),
      EQUITY,
      NOW
    );
    g.registerEntry(tracked({ symbol: "GBP/USD", score: 85 }));
    expect(g.evaluate(candidate({ score: 90 }), EQUITY, NOW).rejects).toContain(
      "correlation_group_cap"
    );
  });

  it("applique le plafond spécifique d'un groupe avant le plafond par défaut", () => {
    const g = new PortfolioGovernor(
      params({
        correlationGroupMaxRiskPct: 10,
        correlationGroupOverrides: { usd: 0.4 },
        correlationOverrideScoreDelta: 0,
      }),
      EQUITY,
      NOW
    );
    expect(g.evaluate(candidate(), EQUITY, NOW).rejects).toContain("correlation_group_cap");
  });

  it("compte les entrées déjà retenues dans le même lot (pending)", () => {
    const g = new PortfolioGovernor(params({ correlationGroupMaxRiskPct: 0.75 }), EQUITY, NOW);
    const pending = [tracked({ symbol: "AUD/USD" })];
    expect(g.evaluate(candidate(), EQUITY, NOW, pending).rejects).toContain(
      "correlation_group_cap"
    );
  });
});

describe("PortfolioGovernor — bascules jour/semaine", () => {
  it("remet les compteurs du jour à zéro au changement de date UTC", () => {
    const g = new PortfolioGovernor(params(), EQUITY, NOW);
    g.registerEntry(tracked({ groups: [] }));
    expect(g.snapshot(EQUITY, NOW).entriesToday).toBe(1);
    g.rollTime(NOW + 24 * 3_600_000, EQUITY);
    expect(g.snapshot(EQUITY, NOW).entriesToday).toBe(0);
  });

  it("rattache une date au lundi de sa semaine", () => {
    expect(weekKey(Date.UTC(2026, 5, 1))).toBe("2026-06-01"); // lundi
    expect(weekKey(Date.UTC(2026, 5, 7))).toBe("2026-06-01"); // dimanche
    expect(weekKey(Date.UTC(2026, 5, 8))).toBe("2026-06-08"); // lundi suivant
  });
});

describe("manageStop", () => {
  const stop = { ...DEFAULT_SPC_PARAMS.stop, breakEvenAtR: 1, trailAfterR: 1.5, trailAtrMult: 2 };

  it("ne bouge pas avant le seuil de break-even", () => {
    const r = manageStop({
      direction: "long", entryPrice: 100, currentStop: 98, initialRisk: 2,
      price: 101, atr: 1, params: stop,
    });
    expect(r.newStop).toBeNull();
  });

  it("remonte au point mort à +1R", () => {
    const r = manageStop({
      direction: "long", entryPrice: 100, currentStop: 98, initialRisk: 2,
      price: 102, atr: 1, params: stop,
    });
    expect(r.newStop).toBe(100);
  });

  it("passe en trailing au-delà du seuil configuré", () => {
    const r = manageStop({
      direction: "long", entryPrice: 100, currentStop: 100, initialRisk: 2,
      price: 110, atr: 1, params: stop,
    });
    expect(r.newStop).toBe(108); // 110 − 2×ATR
  });

  it("ne recule JAMAIS un stop déjà plus proche du prix", () => {
    const r = manageStop({
      direction: "long", entryPrice: 100, currentStop: 109, initialRisk: 2,
      price: 110, atr: 1, params: stop,
    });
    expect(r.newStop).toBeNull();
  });

  it("fonctionne symétriquement en short", () => {
    const r = manageStop({
      direction: "short", entryPrice: 100, currentStop: 102, initialRisk: 2,
      price: 90, atr: 1, params: stop,
    });
    expect(r.newStop).toBe(92); // 90 + 2×ATR
  });

  it("ne fait rien si break-even et trailing sont désactivés", () => {
    const off = { ...stop, breakEvenAtR: null, trailAfterR: null };
    const r = manageStop({
      direction: "long", entryPrice: 100, currentStop: 98, initialRisk: 2,
      price: 120, atr: 1, params: off,
    });
    expect(r.newStop).toBeNull();
  });
});
