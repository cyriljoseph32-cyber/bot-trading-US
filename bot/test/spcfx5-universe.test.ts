import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  loadSpcConfig,
  selectSpcUniverse,
  parseGroupRef,
  groupBets,
  volatilityBandOf,
  costBpsOf,
  correlationOverrides,
  type SpcConfig,
} from "../src/strategy/spcfx5/universe";
import { rankAndSelect } from "../src/strategy/spcfx5/ranking";
import { PortfolioGovernor, DEFAULT_SPC_PORTFOLIO } from "../src/risk/portfolio";
import type { SpcAsset, SpcSignal } from "../src/strategy/spcfx5/types";

const CONFIG_PATH = join(import.meta.dirname, "..", "config", "spcfx5.json");

function asset(over: Partial<SpcAsset> = {}): SpcAsset {
  return {
    std: "EURUSD",
    provider: "EUR/USD",
    category: "fx_major",
    assetClass: "fx",
    exchange: "FOREX",
    currency: "USD",
    country: "XX",
    enabled: true,
    groups: ["usd:-1", "eur:+1"],
    ...over,
  };
}

describe("configuration livrée (bot/config/spcfx5.json)", () => {
  const config = loadSpcConfig(CONFIG_PATH);

  it("contient 100 actifs, sans doublon de symbole fournisseur", () => {
    expect(config.assets).toHaveLength(100);
    const providers = config.assets.map((a) => a.provider);
    expect(new Set(providers).size).toBe(providers.length);
  });

  it("ne référence que des groupes de corrélation déclarés", () => {
    const declared = new Set(Object.keys(config.correlationGroups ?? {}));
    for (const a of config.assets) {
      for (const ref of a.groups) {
        expect(declared.has(parseGroupRef(ref).group)).toBe(true);
      }
    }
  });

  it("documente chaque actif désactivé par une note", () => {
    for (const a of config.assets.filter((x) => !x.enabled)) {
      expect(a.note, `${a.std} désactivé sans explication`).toBeTruthy();
    }
  });

  it("se charge en un univers exploitable", () => {
    const { selected, skipped } = selectSpcUniverse(config, 100);
    expect(selected.length).toBeGreaterThan(50);
    expect(selected.length + skipped.length).toBe(100);
    expect(skipped.every((s) => s.reason === "disabled")).toBe(true);
  });
});

describe("selectSpcUniverse", () => {
  const base: SpcConfig = {
    assets: [
      asset(),
      asset({ std: "GBPUSD", provider: "GBP/USD" }),
      asset({ std: "OFF", provider: "OFF", enabled: false }),
      asset({ std: "DOUBLON", provider: "EUR/USD" }),
      asset({ std: "BIZARRE", provider: "BIZ", category: "inconnue" as never }),
    ],
  };

  it("écarte les actifs désactivés, dupliqués ou de catégorie inconnue, avec la raison", () => {
    const { selected, skipped } = selectSpcUniverse(base, 100);
    expect(selected.map((s) => s.asset.std)).toEqual(["EURUSD", "GBPUSD"]);
    expect(skipped).toEqual([
      { std: "OFF", reason: "disabled" },
      { std: "DOUBLON", reason: "duplicate_symbol" },
      { std: "BIZARRE", reason: "unknown_category" },
    ]);
  });

  it("tronque au plafond de symboles en signalant le dépassement", () => {
    const { selected, skipped } = selectSpcUniverse(base, 1);
    expect(selected).toHaveLength(1);
    expect(skipped).toContainEqual({ std: "GBPUSD", reason: "over_symbol_cap" });
  });

  it("construit un Instrument exploitable par le reste du bot", () => {
    const { selected } = selectSpcUniverse(base, 100);
    expect(selected[0].instrument).toMatchObject({
      symbol: "EUR/USD",
      assetClass: "fx",
      exchange: "FOREX",
      currency: "USD",
    });
  });
});

describe("groupes de corrélation", () => {
  it("décode le signe du pari, +1 par défaut", () => {
    expect(parseGroupRef("usd:-1")).toEqual({ group: "usd", sign: -1 });
    expect(parseGroupRef("usd:+1")).toEqual({ group: "usd", sign: 1 });
    expect(parseGroupRef("metals")).toEqual({ group: "metals", sign: 1 });
  });

  it("traduit long EURUSD et short USDCHF par le même pari sur l'USD", () => {
    const eurusd = groupBets(asset(), "long");
    const usdchf = groupBets(
      asset({ std: "USDCHF", provider: "USD/CHF", groups: ["usd:+1"] }),
      "short"
    );
    expect(eurusd).toContainEqual({ group: "usd", direction: "short" });
    expect(usdchf).toContainEqual({ group: "usd", direction: "short" });
  });

  it("expose les plafonds de groupe au format du gouverneur", () => {
    const config: SpcConfig = { assets: [], correlationGroups: { usd: { maxRiskPct: 1.5 } } };
    expect(correlationOverrides(config)).toEqual({ usd: 1.5 });
  });
});

describe("réglages par catégorie", () => {
  const config: SpcConfig = {
    assets: [],
    categories: { fx_major: { minAtrPct: 0.1, maxAtrPct: 0.5, costBps: 2 } },
  };

  it("remonte la bande de volatilité et le coût de la catégorie", () => {
    expect(volatilityBandOf(asset(), config)).toEqual({ minAtrPct: 0.1, maxAtrPct: 0.5 });
    expect(costBpsOf(asset(), config)).toBe(2);
  });

  it("laisse le coût propre à l'actif primer sur celui de la catégorie", () => {
    expect(costBpsOf(asset({ costBps: 0.8 }), config)).toBe(0.8);
  });
});

/* ─── Classement ────────────────────────────────────────────────────────── */

function signal(over: Partial<SpcSignal> = {}): SpcSignal {
  return {
    symbol: "EUR/USD",
    std: "EURUSD",
    assetClass: "fx",
    category: "fx_major",
    tf: "1h",
    side: "long",
    score: 80,
    parts: [],
    reasons: [],
    rejects: [],
    notes: [],
    price: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.12,
    riskPerUnit: 0.01,
    rrGross: 2,
    rrNet: 1.8,
    atr: 0.005,
    ts: Date.UTC(2026, 5, 1, 12, 0, 0),
    eligible: true,
    ...over,
  };
}

describe("rankAndSelect", () => {
  const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
  const governor = (): PortfolioGovernor =>
    new PortfolioGovernor(
      { ...DEFAULT_SPC_PORTFOLIO, correlationGroupOverrides: {} },
      100_000,
      NOW
    );

  it("classe par score décroissant et ignore les signaux non éligibles", () => {
    const ranked = rankAndSelect({
      signals: [
        { signal: signal({ std: "A", symbol: "A", score: 72 }), asset: asset({ std: "A", provider: "A", groups: [] }) },
        { signal: signal({ std: "B", symbol: "B", score: 91 }), asset: asset({ std: "B", provider: "B", groups: [] }) },
        { signal: signal({ std: "C", symbol: "C", score: 99, eligible: false }), asset: asset({ std: "C", provider: "C", groups: [] }) },
      ],
      governor: governor(),
      equity: 100_000,
      now: NOW,
      riskPctPerTrade: 0.5,
    });
    expect(ranked.map((r) => r.signal.std)).toEqual(["B", "A"]);
    expect(ranked[0].rank).toBe(1);
  });

  it("départage deux scores égaux par le RR net puis par le symbole", () => {
    const ranked = rankAndSelect({
      signals: [
        { signal: signal({ std: "A", symbol: "A", rrNet: 1.5 }), asset: asset({ std: "A", provider: "A", groups: [] }) },
        { signal: signal({ std: "B", symbol: "B", rrNet: 2.4 }), asset: asset({ std: "B", provider: "B", groups: [] }) },
      ],
      governor: governor(),
      equity: 100_000,
      now: NOW,
      riskPctPerTrade: 0.5,
    });
    expect(ranked.map((r) => r.signal.std)).toEqual(["B", "A"]);
  });

  it("laisse le meilleur score consommer le budget du groupe et refuse le suivant", () => {
    const ranked = rankAndSelect({
      signals: [
        { signal: signal({ std: "EURUSD", symbol: "EUR/USD", score: 92 }), asset: asset() },
        {
          signal: signal({ std: "GBPUSD", symbol: "GBP/USD", score: 85 }),
          asset: asset({ std: "GBPUSD", provider: "GBP/USD", groups: ["usd:-1"] }),
        },
      ],
      governor: new PortfolioGovernor(
        { ...DEFAULT_SPC_PORTFOLIO, correlationGroupMaxRiskPct: 0.75, correlationOverrideScoreDelta: 0 },
        100_000,
        NOW
      ),
      equity: 100_000,
      now: NOW,
      riskPctPerTrade: 0.5,
    });
    expect(ranked[0].selected).toBe(true);
    expect(ranked[1].selected).toBe(false);
    expect(ranked[1].decision.rejects).toContain("correlation_group_cap");
  });

  it("réduit la taille d'une entrée acceptée par exception de corrélation", () => {
    const ranked = rankAndSelect({
      signals: [
        { signal: signal({ std: "EURUSD", symbol: "EUR/USD", score: 70 }), asset: asset() },
        {
          signal: signal({ std: "GBPUSD", symbol: "GBP/USD", score: 95 }),
          asset: asset({ std: "GBPUSD", provider: "GBP/USD", groups: ["usd:-1"] }),
        },
      ],
      governor: new PortfolioGovernor(
        {
          ...DEFAULT_SPC_PORTFOLIO,
          correlationGroupMaxRiskPct: 0.75,
          correlationOverrideScoreDelta: 10,
          correlationOverrideSizeMult: 0.5,
        },
        100_000,
        NOW
      ),
      equity: 100_000,
      now: NOW,
      riskPctPerTrade: 0.5,
    });
    // Le meilleur score passe en premier ; le second force le groupe, en plus petit.
    expect(ranked[0].signal.std).toBe("GBPUSD");
    expect(ranked[1].selected).toBe(false);
  });

  it("ne modifie pas l'état du gouverneur — c'est au runner d'enregistrer", () => {
    const g = governor();
    rankAndSelect({
      signals: [{ signal: signal(), asset: asset({ groups: [] }) }],
      governor: g,
      equity: 100_000,
      now: NOW,
      riskPctPerTrade: 0.5,
    });
    expect(g.openEntries()).toHaveLength(0);
  });
});
