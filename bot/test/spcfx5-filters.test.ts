import { describe, it, expect } from "vitest";
import {
  volatilityFilter,
  estimateCost,
  costFilter,
  volumeFilter,
  sessionFilter,
  newsFilter,
  antiChopFilter,
  spreadBps,
  assetCurrencies,
  type NewsEvent,
} from "../src/strategy/spcfx5/filters";
import { confirmBreakout } from "../src/strategy/spcfx5/breakout";
import { DEFAULT_SPC_PARAMS } from "../src/strategy/spcfx5/params";
import type { SpcAsset } from "../src/strategy/spcfx5/types";
import type { Quote } from "../src/types";

const P = DEFAULT_SPC_PARAMS;

const eurusd: SpcAsset = {
  std: "EURUSD",
  provider: "EUR/USD",
  category: "fx_major",
  assetClass: "fx",
  exchange: "FOREX",
  currency: "USD",
  country: "XX",
  enabled: true,
  groups: ["usd:-1", "eur:+1"],
};

const aapl: SpcAsset = {
  std: "AAPL",
  provider: "AAPL",
  category: "equity",
  assetClass: "equity",
  exchange: "NASDAQ",
  currency: "USD",
  country: "US",
  enabled: true,
  groups: ["equity_tech:+1"],
};

function quote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "EUR/USD",
    assetClass: "fx",
    exchange: "FOREX",
    currency: "USD",
    bid: 1.0999,
    ask: 1.1001,
    last: 1.1,
    volume: null,
    ts: Date.UTC(2026, 5, 1, 10, 0, 0),
    stale: false,
    ...over,
  };
}

describe("volatilityFilter", () => {
  it("rejette un actif trop calme puis trop agité", () => {
    expect(volatilityFilter(0.0001, 1.1, "fx_major", P.volatility).reject).toBe("volatility_too_low");
    expect(volatilityFilter(0.05, 1.1, "fx_major", P.volatility).reject).toBe("volatility_too_high");
  });

  it("accepte une volatilité dans la bande de la catégorie", () => {
    expect(volatilityFilter(0.0022, 1.1, "fx_major", P.volatility).pass).toBe(true);
  });

  it("laisse tout passer une fois désactivé", () => {
    const off = { ...P.volatility, enabled: false };
    expect(volatilityFilter(0.05, 1.1, "fx_major", off).pass).toBe(true);
  });

  it("applique la surcharge de bande fournie par la config", () => {
    const verdict = volatilityFilter(0.0022, 1.1, "fx_major", P.volatility, { maxAtrPct: 0.1 });
    expect(verdict.reject).toBe("volatility_too_high");
  });
});

describe("coût d'exécution", () => {
  it("ne considère pas un bid/ask reconstitué comme un spread mesuré", () => {
    expect(spreadBps(quote())).toBeCloseTo(1.818, 2);
    expect(spreadBps(quote({ estimated: true }))).toBeNull();
    expect(spreadBps(quote({ bid: null, ask: null }))).toBeNull();
  });

  it("calcule un RR net inférieur au RR brut", () => {
    const estimate = estimateCost(1.1, 0.002, 2, eurusd, quote(), P.cost);
    expect(estimate.rrGross).toBeCloseTo(2, 5);
    expect(estimate.rrNet).toBeLessThan(estimate.rrGross);
    expect(estimate.spreadMeasured).toBe(true);
  });

  it("rejette un setup dont le RR net tombe sous le minimum", () => {
    // Stop minuscule : le coût dévore tout le potentiel.
    const estimate = estimateCost(1.1, 0.00002, 2, eurusd, quote(), P.cost);
    expect(costFilter(estimate, P.cost).reject).toBe("cost_too_high");
  });

  it("signale un spread inconnu au lieu de le supposer mesuré", () => {
    const estimate = estimateCost(1.1, 0.01, 2, eurusd, null, P.cost);
    expect(estimate.spreadMeasured).toBe(false);
    const verdict = costFilter(estimate, P.cost);
    expect(verdict.pass).toBe(true);
    expect(verdict.note).toBe("spread_unknown");
  });

  it("conserve la note même quand le coût provoque le rejet", () => {
    const estimate = estimateCost(1.1, 0.00002, 2, eurusd, null, P.cost);
    const verdict = costFilter(estimate, P.cost);
    expect(verdict.reject).toBe("cost_too_high");
    expect(verdict.note).toBe("spread_unknown");
  });

  it("laisse passer une fois désactivé", () => {
    const estimate = estimateCost(1.1, 0.00002, 2, eurusd, quote(), P.cost);
    expect(costFilter(estimate, { ...P.cost, enabled: false }).pass).toBe(true);
  });
});

describe("volumeFilter", () => {
  it("signale explicitement l'absence de volume sur le FX, sans pénaliser", () => {
    const verdict = volumeFilter([0, 0, 0], "fx", P.volume);
    expect(verdict.pass).toBe(true);
    expect(verdict.note).toBe("volume_unavailable");
  });

  it("rejette un volume anormalement faible sur une action", () => {
    const volumes = [...Array<number>(20).fill(1000), 50];
    expect(volumeFilter(volumes, "equity", P.volume).reject).toBe("volume_thin");
  });

  it("accepte un volume normal", () => {
    const volumes = [...Array<number>(20).fill(1000), 1200];
    expect(volumeFilter(volumes, "equity", P.volume).pass).toBe(true);
  });
});

describe("sessionFilter", () => {
  const lundi = (h: number): number => Date.UTC(2026, 5, 1, h, 0, 0); // lundi
  const samedi = Date.UTC(2026, 5, 6, 12, 0, 0);

  it("FX : accepte Londres/New York, refuse la nuit asiatique", () => {
    expect(sessionFilter(eurusd, lundi(10), P.session).pass).toBe(true);
    expect(sessionFilter(eurusd, lundi(3), P.session).reject).toBe("session_closed");
  });

  it("FX : refuse le week-end", () => {
    expect(sessionFilter(eurusd, samedi, P.session).reject).toBe("session_closed");
  });

  it("actions : suit la séance de l'exchange", () => {
    expect(sessionFilter(aapl, lundi(15), P.session).pass).toBe(true);
    expect(sessionFilter(aapl, lundi(6), P.session).reject).toBe("session_closed");
  });

  it("crypto : ouvert 24/7 sauf heures creuses configurées", () => {
    const btc: SpcAsset = { ...eurusd, std: "BTCUSD", provider: "BTC/USD", category: "crypto", assetClass: "crypto", exchange: "CRYPTO" };
    expect(sessionFilter(btc, samedi, P.session).pass).toBe(true);
    const withGap = {
      ...P.session,
      cryptoExcluded: [{ name: "creux", openMin: 0, closeMin: 5 * 60 }],
    };
    expect(sessionFilter(btc, Date.UTC(2026, 5, 6, 2, 0, 0), withGap).reject).toBe("session_closed");
  });

  it("or : suit le calendrier FX, pas celui d'une bourse", () => {
    const gold: SpcAsset = { ...eurusd, std: "XAUUSD", provider: "XAU/USD", category: "metal" };
    expect(sessionFilter(gold, samedi, P.session).reject).toBe("session_closed");
    expect(sessionFilter(gold, lundi(14), P.session).pass).toBe(true);
  });

  it("désactivé (backtest) : tout passe", () => {
    expect(sessionFilter(eurusd, samedi, { ...P.session, enabled: false }).pass).toBe(true);
  });
});

describe("newsFilter", () => {
  const annonce = Date.UTC(2026, 5, 1, 12, 30, 0);
  const events: NewsEvent[] = [
    { ts: annonce, impact: "high", currencies: ["USD"], title: "FOMC" },
    { ts: annonce, impact: "medium", currencies: ["EUR"], title: "PIB" },
  ];

  it("bloque avant et après l'annonce, laisse passer en dehors", () => {
    expect(newsFilter(eurusd, annonce - 10 * 60_000, events, P.news).reject).toBe("news_blackout");
    expect(newsFilter(eurusd, annonce + 10 * 60_000, events, P.news).reject).toBe("news_blackout");
    expect(newsFilter(eurusd, annonce - 90 * 60_000, events, P.news).pass).toBe(true);
  });

  it("ignore les annonces d'impact moyen", () => {
    const onlyMedium = [events[1]];
    expect(newsFilter(eurusd, annonce, onlyMedium, P.news).pass).toBe(true);
  });

  it("ne bloque que les actifs concernés par la devise", () => {
    const jpyOnly: NewsEvent[] = [{ ts: annonce, impact: "high", currencies: ["JPY"] }];
    expect(newsFilter(eurusd, annonce, jpyOnly, P.news).pass).toBe(true);
  });

  it("traite une annonce sans ciblage comme mondiale", () => {
    const global: NewsEvent[] = [{ ts: annonce, impact: "high" }];
    expect(newsFilter(aapl, annonce, global, P.news).reject).toBe("news_blackout");
  });

  it("reste neutre et le signale quand aucun flux n'est connecté", () => {
    const verdict = newsFilter(eurusd, annonce, null, P.news);
    expect(verdict.pass).toBe(true);
    expect(verdict.note).toBe("news_feed_absent");
  });

  it("expose les deux devises d'une paire FX", () => {
    expect(assetCurrencies(eurusd).sort()).toEqual(["EUR", "USD"]);
  });
});

describe("antiChopFilter", () => {
  it("refuse une entrée collée à la SMA", () => {
    expect(antiChopFilter(100.1, 100, 1, P.antiChop).reject).toBe("chop_too_close_to_sma");
  });

  it("accepte une entrée suffisamment éloignée", () => {
    expect(antiChopFilter(101, 100, 1, P.antiChop).pass).toBe(true);
  });

  it("désactivé : tout passe", () => {
    expect(antiChopFilter(100.01, 100, 1, { ...P.antiChop, enabled: false }).pass).toBe(true);
  });
});

describe("confirmBreakout", () => {
  const highs = [10, 11, 12, 11, 10];
  const lows = [9, 8, 7, 8, 9];

  it("exige une clôture au-delà du niveau ET du buffer", () => {
    const params = { ...P.breakout, lookback: 4, bufferAtrMult: 0.1 };
    // 12 est le plus haut des 4 bougies précédentes ; buffer = 0,1 × ATR(1) = 0,1.
    expect(confirmBreakout(highs, lows, 12.05, "long", 1, params).confirmed).toBe(false);
    expect(confirmBreakout(highs, lows, 12.5, "long", 1, params).confirmed).toBe(true);
  });

  it("fonctionne symétriquement à la baisse", () => {
    const params = { ...P.breakout, lookback: 4, bufferAtrMult: 0.1 };
    expect(confirmBreakout(highs, lows, 6.5, "short", 1, params).confirmed).toBe(true);
    expect(confirmBreakout(highs, lows, 6.95, "short", 1, params).confirmed).toBe(false);
  });

  it("désactivé : confirme sans condition", () => {
    const off = { ...P.breakout, enabled: false };
    expect(confirmBreakout(highs, lows, 1, "long", 1, off).confirmed).toBe(true);
  });

  it("applique le buffer en ticks quand il est plus large que le buffer ATR", () => {
    const params = { ...P.breakout, lookback: 4, bufferAtrMult: 0.01, bufferTicks: 100 };
    // 100 ticks × 0,01 = 1,0 de buffer : une clôture à 12,5 ne suffit plus.
    expect(confirmBreakout(highs, lows, 12.5, "long", 1, params, 0.01).confirmed).toBe(false);
    expect(confirmBreakout(highs, lows, 13.5, "long", 1, params, 0.01).confirmed).toBe(true);
  });
});
