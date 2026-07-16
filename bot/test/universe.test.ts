import { describe, it, expect } from "vitest";
import { selectUniverse, capToWsLimit, type UniverseConfig } from "../src/universe";
import type { Instrument } from "../src/types";

function makeConfig(overrides: Partial<UniverseConfig> = {}): UniverseConfig {
  return {
    selection: {
      topNPerRegion: 2,
      minAvgDollarVolume: 1_000_000,
      maxSpreadBps: 50,
      requireValidData: true,
      rebalanceDays: 30,
    },
    exclusions: [],
    benchmark: { symbol: "SPY", assetClass: "equity", exchange: "NYSE", currency: "USD", country: "US", region: "us" },
    equities: {
      us: {
        exchange: "NASDAQ",
        currency: "USD",
        country: "US",
        seeds: [
          { symbol: "AAPL", sector: "tech" },
          { symbol: "MSFT", sector: "tech" },
          { symbol: "KO", sector: "consumer", exchange: "NYSE" },
        ],
      },
      japan: {
        exchange: "TSE",
        currency: "JPY",
        country: "JP",
        seeds: [{ symbol: "7203", sector: "consumer" }],
      },
    },
    fx: { majors: ["EUR/USD", "USD/JPY"], crosses: ["EUR/GBP"], em: ["USD/MXN"] },
    crypto: { pairs: [] },
    ...overrides,
  };
}

describe("selectUniverse", () => {
  it("applique topN par région et ajoute toutes les paires FX", () => {
    const universe = selectUniverse(makeConfig());
    const equities = universe.filter((i) => i.assetClass === "equity");
    const fx = universe.filter((i) => i.assetClass === "fx");
    expect(equities.filter((i) => i.region === "us")).toHaveLength(2);
    expect(equities.filter((i) => i.region === "japan")).toHaveLength(1);
    expect(fx.map((i) => i.symbol)).toEqual(["EUR/USD", "USD/JPY", "EUR/GBP", "USD/MXN"]);
  });

  it("classe par dollar-volume décroissant quand les stats sont fournies", () => {
    const universe = selectUniverse(makeConfig(), {
      AAPL: { avgDollarVolume: 5_000_000 },
      MSFT: { avgDollarVolume: 50_000_000 },
      KO: { avgDollarVolume: 20_000_000 },
    });
    const us = universe.filter((i) => i.region === "us").map((i) => i.symbol);
    expect(us).toEqual(["MSFT", "KO"]); // top 2 par liquidité
  });

  it("filtre : liquidité insuffisante, spread trop large, données invalides", () => {
    const universe = selectUniverse(makeConfig(), {
      AAPL: { avgDollarVolume: 100 }, // sous le minimum
      MSFT: { spreadBps: 200 }, // spread > 50 bps
      KO: { validData: false },
    });
    expect(universe.filter((i) => i.region === "us")).toHaveLength(0);
  });

  it("respecte les exclusions (insensible à la casse)", () => {
    const universe = selectUniverse(makeConfig({ exclusions: ["aapl", "EUR/USD"] }));
    expect(universe.some((i) => i.symbol === "AAPL")).toBe(false);
    expect(universe.some((i) => i.symbol === "EUR/USD")).toBe(false);
  });

  it("hérite exchange/devise/pays de la région avec surcharge par seed", () => {
    const universe = selectUniverse(makeConfig());
    const ko = selectUniverse(makeConfig(), { AAPL: { avgDollarVolume: 1 } }); // évince AAPL
    expect(ko.find((i) => i.symbol === "KO")?.exchange).toBe("NYSE"); // surcharge
    expect(universe.find((i) => i.symbol === "MSFT")?.exchange).toBe("NASDAQ"); // hérité
    expect(universe.find((i) => i.symbol === "7203")?.currency).toBe("JPY");
  });
});

describe("capToWsLimit", () => {
  const bench: Instrument = {
    symbol: "SPY", assetClass: "equity", exchange: "NYSE",
    currency: "USD", country: "US", region: "us",
  };

  it("garantit la présence du benchmark et tronque à la limite", () => {
    const universe = selectUniverse(makeConfig());
    const capped = capToWsLimit(universe, bench, 4);
    expect(capped).toHaveLength(4);
    expect(capped[0].symbol).toBe("SPY");
  });

  it("ne duplique pas le benchmark s'il est déjà présent", () => {
    const capped = capToWsLimit([bench], bench, 8);
    expect(capped.filter((i) => i.symbol === "SPY")).toHaveLength(1);
  });
});
