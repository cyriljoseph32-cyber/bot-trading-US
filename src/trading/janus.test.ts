import { describe, it, expect } from "vitest";
import {
  Janus,
  historyEntry,
  type ScoredOutcome,
  type CohortRecommendations,
} from "./janus";

/** Date ISO il y a `days` jours (UTC) — pour fabriquer des outcomes datés. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe("Janus — initialisation", () => {
  it("répartit des poids égaux au départ", () => {
    const j = new Janus(["18month", "10year"]);
    expect(j.cohortWeights).toEqual({ "18month": 0.5, "10year": 0.5 });
    expect(j.cohortAccuracy["18month"]).toEqual({ hitRate: 0.5, sharpe: 0 });
  });

  it("gère un nombre arbitraire de cohortes", () => {
    const j = new Janus(["a", "b", "c", "d"]);
    for (const k of ["a", "b", "c", "d"]) {
      expect(j.cohortWeights[k]).toBeCloseTo(0.25, 10);
    }
  });

  it("retombe sur les cohortes par défaut si la liste est vide", () => {
    const j = new Janus([]);
    expect(j.cohorts).toEqual(["18month", "10year"]);
  });
});

describe("Janus — scoreRecommendation", () => {
  const j = new Janus();

  it("LONG gagnant : hit et rendement pondéré positif", () => {
    const s = j.scoreRecommendation({ ticker: "AVGO", direction: "LONG", conviction: 80 }, 0.02);
    expect(s.isHit).toBe(true);
    expect(s.weightedReturn).toBeCloseTo(0.8 * 0.02, 10);
  });

  it("LONG perdant : miss", () => {
    const s = j.scoreRecommendation({ ticker: "AVGO", conviction: 50 }, -0.01);
    expect(s.isHit).toBe(false);
    expect(s.weightedReturn).toBeCloseTo(0.5 * -0.01, 10);
  });

  it("SHORT gagnant sur baisse : hit et rendement pondéré positif", () => {
    const s = j.scoreRecommendation({ ticker: "XYZ", direction: "short", conviction: 60 }, -0.03);
    expect(s.isHit).toBe(true);
    expect(s.weightedReturn).toBeCloseTo(0.6 * 0.03, 10);
  });

  it("direction par défaut = LONG, conviction par défaut = 50", () => {
    const s = j.scoreRecommendation({ ticker: "T" }, 0.01);
    expect(s.direction).toBe("LONG");
    expect(s.weightedReturn).toBeCloseTo(0.5 * 0.01, 10);
  });
});

describe("Janus — calculateCohortMetrics", () => {
  const j = new Janus();

  it("neutre quand il n'y a aucun outcome dans la fenêtre", () => {
    const m = j.calculateCohortMetrics("18month", []);
    expect(m).toEqual({ hitRate: 0.5, sharpe: 0 });
  });

  it("hit-rate = fraction des hits récents", () => {
    const outcomes: ScoredOutcome[] = [
      { cohort: "18month", date: daysAgo(1), isHit: true, weightedReturn: 0.02 },
      { cohort: "18month", date: daysAgo(2), isHit: false, weightedReturn: -0.01 },
      { cohort: "18month", date: daysAgo(3), isHit: true, weightedReturn: 0.03 },
      { cohort: "18month", date: daysAgo(4), isHit: true, weightedReturn: 0.01 },
    ];
    const m = j.calculateCohortMetrics("18month", outcomes);
    expect(m.hitRate).toBeCloseTo(0.75, 10);
    expect(m.sharpe).toBeGreaterThan(0);
  });

  it("ignore les outcomes hors fenêtre glissante", () => {
    const outcomes: ScoredOutcome[] = [
      { cohort: "18month", date: daysAgo(100), isHit: true, weightedReturn: 0.02 },
      { cohort: "18month", date: daysAgo(1), isHit: false, weightedReturn: -0.01 },
    ];
    const m = j.calculateCohortMetrics("18month", outcomes);
    // Un seul outcome dans la fenêtre → hit-rate 0, Sharpe 0 (moins de 2 points).
    expect(m.hitRate).toBe(0);
    expect(m.sharpe).toBe(0);
  });

  it("ignore les outcomes d'une autre cohorte", () => {
    const outcomes: ScoredOutcome[] = [
      { cohort: "10year", date: daysAgo(1), isHit: true, weightedReturn: 0.02 },
    ];
    const m = j.calculateCohortMetrics("18month", outcomes);
    expect(m).toEqual({ hitRate: 0.5, sharpe: 0 });
  });
});

describe("Janus — updateWeights & contraintes", () => {
  it("respecte le plancher et le plafond, somme = 1", () => {
    const j = new Janus(["18month", "10year"]);
    // 18month parfait, 10year nul → 18month devrait dominer mais rester ≤ 0.8.
    const outcomes: ScoredOutcome[] = [];
    for (let i = 0; i < 10; i++) {
      outcomes.push({ cohort: "18month", date: daysAgo(i + 1), isHit: true, weightedReturn: 0.02 });
      outcomes.push({ cohort: "10year", date: daysAgo(i + 1), isHit: false, weightedReturn: -0.02 });
    }
    j.updateWeights(outcomes);

    const w18 = j.cohortWeights["18month"];
    const w10 = j.cohortWeights["10year"];
    expect(w18 + w10).toBeCloseTo(1, 10);
    expect(w18).toBeLessThanOrEqual(Janus.MAX_WEIGHT + 1e-9);
    expect(w10).toBeGreaterThanOrEqual(Janus.MIN_WEIGHT - 1e-9);
    expect(w18).toBeGreaterThan(w10);
  });

  it("performances égales → poids égaux", () => {
    const j = new Janus(["18month", "10year"]);
    const outcomes: ScoredOutcome[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push({ cohort: "18month", date: daysAgo(i + 1), isHit: true, weightedReturn: 0.01 });
      outcomes.push({ cohort: "10year", date: daysAgo(i + 1), isHit: true, weightedReturn: 0.01 });
    }
    j.updateWeights(outcomes);
    expect(j.cohortWeights["18month"]).toBeCloseTo(0.5, 6);
    expect(j.cohortWeights["10year"]).toBeCloseTo(0.5, 6);
  });
});

describe("Janus — regimeSignal", () => {
  it("NOVEL_REGIME quand la cohorte courte domine nettement", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 0.8, "10year": 0.2 };
    expect(j.regimeSignal()).toBe("NOVEL_REGIME");
  });

  it("HISTORICAL_REGIME quand la cohorte longue domine nettement", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 0.2, "10year": 0.8 };
    expect(j.regimeSignal()).toBe("HISTORICAL_REGIME");
  });

  it("MIXED quand l'écart est sous le seuil", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 0.55, "10year": 0.45 };
    expect(j.regimeSignal()).toBe("MIXED");
  });
});

describe("Janus — blendRecommendations", () => {
  it("renvoie un résultat vide sans cohorte", () => {
    const j = new Janus();
    expect(j.blendRecommendations({})).toEqual({
      blendedRecommendations: [],
      contestedTickers: [],
    });
  });

  it("accord des deux cohortes : conviction pondérée additionnée, non contesté", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 0.5, "10year": 0.5 };
    const recs: Record<string, CohortRecommendations> = {
      "18month": { recommendations: [{ ticker: "NVDA", direction: "LONG", conviction: 80, agents: ["druck"] }] },
      "10year": { recommendations: [{ ticker: "NVDA", direction: "LONG", conviction: 60, agents: ["ackman"] }] },
    };
    const out = j.blendRecommendations(recs);
    expect(out.contestedTickers).toEqual([]);
    const nvda = out.blendedRecommendations[0];
    expect(nvda.ticker).toBe("NVDA");
    expect(nvda.direction).toBe("LONG");
    // 80*0.5 + 60*0.5 = 70
    expect(nvda.conviction).toBeCloseTo(70, 6);
    expect(nvda.agents.sort()).toEqual(["ackman", "druck"]);
  });

  it("désaccord : ticker contesté et conviction amputée", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 0.5, "10year": 0.5 };
    const recs: Record<string, CohortRecommendations> = {
      "18month": { recommendations: [{ ticker: "TSLA", direction: "LONG", conviction: 80 }] },
      "10year": { recommendations: [{ ticker: "TSLA", direction: "SHORT", conviction: 40 }] },
    };
    const out = j.blendRecommendations(recs);
    expect(out.contestedTickers).toEqual(["TSLA"]);
    const tsla = out.blendedRecommendations[0];
    expect(tsla.contested).toBe(true);
    // long=40, short=20 → LONG gagne ; pénalité = 20*0.5 = 10 → 40-10 = 30.
    expect(tsla.direction).toBe("LONG");
    expect(tsla.conviction).toBeCloseTo(30, 6);
  });

  it("trie les recommandations par conviction décroissante", () => {
    const j = new Janus();
    j.cohortWeights = { "18month": 1, "10year": 0 };
    const recs: Record<string, CohortRecommendations> = {
      "18month": {
        recommendations: [
          { ticker: "LOW", conviction: 30 },
          { ticker: "HIGH", conviction: 90 },
        ],
      },
    };
    const out = j.blendRecommendations(recs);
    expect(out.blendedRecommendations.map((r) => r.ticker)).toEqual(["HIGH", "LOW"]);
  });
});

describe("Janus — runDaily & historyEntry", () => {
  it("produit une sortie complète et un résumé d'historique cohérent", () => {
    const j = new Janus(["18month", "10year"]);
    const outcomes: ScoredOutcome[] = [
      { cohort: "18month", date: daysAgo(1), isHit: true, weightedReturn: 0.02 },
      { cohort: "18month", date: daysAgo(2), isHit: true, weightedReturn: 0.01 },
      { cohort: "10year", date: daysAgo(1), isHit: false, weightedReturn: -0.01 },
      { cohort: "10year", date: daysAgo(2), isHit: true, weightedReturn: 0.005 },
    ];
    const recs: Record<string, CohortRecommendations> = {
      "18month": { recommendations: [{ ticker: "AVGO", direction: "LONG", conviction: 85 }] },
      "10year": { recommendations: [{ ticker: "AVGO", direction: "LONG", conviction: 70 }] },
    };

    const out = j.runDaily(outcomes, recs, "2026-07-13");
    expect(out.date).toBe("2026-07-13");
    expect(out.blendedRecommendations).toHaveLength(1);
    expect(out.blendedRecommendations[0].ticker).toBe("AVGO");
    expect(out.cohortWeights["18month"] + out.cohortWeights["10year"]).toBeCloseTo(1, 3);
    expect(["NOVEL_REGIME", "HISTORICAL_REGIME", "MIXED"]).toContain(out.regime);

    const h = historyEntry(out);
    expect(h.date).toBe("2026-07-13");
    expect(h.numRecommendations).toBe(1);
    expect(h.numContested).toBe(0);
    expect(h.regime).toBe(out.regime);
  });
});
