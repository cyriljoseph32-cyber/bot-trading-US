/* ─── Univers dynamique piloté par la configuration (pur, testable) ────────
 *
 * Charge bot/config/universe.json, applique les critères de sélection
 * (liquidité, spread, exclusions, topN par région) et produit la liste
 * d'instruments à suivre. Le reclassement par liquidité réelle est optionnel
 * (stats injectées — fournies par le provider quand UNIVERSE_DYNAMIC=true).
 */

import { readFileSync } from "node:fs";
import type { Instrument } from "./types";

export interface SeedEquity {
  symbol: string;
  name?: string;
  sector?: string;
  /** Surcharges éventuelles de la région. */
  exchange?: string;
  currency?: string;
  country?: string;
}

export interface RegionConfig {
  exchange: string;
  currency: string;
  country: string;
  seeds: SeedEquity[];
}

export interface UniverseConfig {
  selection: {
    topNPerRegion: number;
    minAvgDollarVolume: number;
    maxSpreadBps: number;
    requireValidData: boolean;
    rebalanceDays: number;
  };
  exclusions: string[];
  benchmark: { symbol: string; assetClass: "equity"; exchange: string; currency: string; country: string; region: string };
  equities: Record<string, RegionConfig>;
  fx: { majors: string[]; crosses: string[]; em: string[] };
  crypto: { pairs: string[] };
}

/** Statistiques de liquidité par symbole (fournies par le provider, optionnel). */
export interface SymbolStats {
  /** Volume moyen quotidien × prix, en devise de cotation. */
  avgDollarVolume?: number;
  marketCap?: number;
  /** Spread observé en points de base. */
  spreadBps?: number;
  /** false si le fournisseur ne renvoie pas de données valides. */
  validData?: boolean;
}

export function loadUniverseConfig(path: string): UniverseConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as UniverseConfig;
}

function equityInstrument(region: string, cfg: RegionConfig, seed: SeedEquity): Instrument {
  return {
    symbol: seed.symbol,
    name: seed.name,
    assetClass: "equity",
    exchange: seed.exchange ?? cfg.exchange,
    currency: seed.currency ?? cfg.currency,
    country: seed.country ?? cfg.country,
    sector: seed.sector,
    region,
  };
}

function fxInstrument(pair: string): Instrument {
  return {
    symbol: pair,
    assetClass: "fx",
    exchange: "FOREX",
    currency: pair.split("/")[1] ?? "USD",
    country: "XX",
    region: "fx",
  };
}

function cryptoInstrument(pair: string): Instrument {
  return {
    symbol: pair,
    assetClass: "crypto",
    exchange: "CRYPTO",
    currency: pair.split("/")[1] ?? "USD",
    country: "XX",
    region: "crypto",
  };
}

/**
 * Sélectionne l'univers final :
 *  1. exclusions retirées ;
 *  2. actions filtrées par liquidité/spread/données valides (si stats connues —
 *     un symbole sans stats est conservé, le flux le disqualifiera s'il est
 *     muet) puis classées par (dollar-volume desc, market cap desc) ;
 *  3. topN par région ;
 *  4. FX et crypto ajoutés tels quels (déjà des listes cannoniques).
 */
export function selectUniverse(
  config: UniverseConfig,
  stats: Record<string, SymbolStats> = {}
): Instrument[] {
  const excluded = new Set(config.exclusions.map((s) => s.toUpperCase()));
  const sel = config.selection;
  const out: Instrument[] = [];

  for (const [region, cfg] of Object.entries(config.equities)) {
    const candidates = cfg.seeds
      .map((seed) => equityInstrument(region, cfg, seed))
      .filter((inst) => !excluded.has(inst.symbol.toUpperCase()))
      .filter((inst) => {
        const s = stats[inst.symbol];
        if (!s) return true; // pas de stats : on garde, le flux tranchera
        if (sel.requireValidData && s.validData === false) return false;
        if (s.avgDollarVolume !== undefined && s.avgDollarVolume < sel.minAvgDollarVolume) return false;
        if (s.spreadBps !== undefined && s.spreadBps > sel.maxSpreadBps) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = stats[a.symbol] ?? {};
        const sb = stats[b.symbol] ?? {};
        const dv = (sb.avgDollarVolume ?? 0) - (sa.avgDollarVolume ?? 0);
        if (dv !== 0) return dv;
        return (sb.marketCap ?? 0) - (sa.marketCap ?? 0);
      });
    out.push(...candidates.slice(0, sel.topNPerRegion));
  }

  const fxPairs = [...config.fx.majors, ...config.fx.crosses, ...config.fx.em];
  for (const pair of fxPairs) {
    if (!excluded.has(pair.toUpperCase())) out.push(fxInstrument(pair));
  }
  for (const pair of config.crypto.pairs) {
    if (!excluded.has(pair.toUpperCase())) out.push(cryptoInstrument(pair));
  }

  return out;
}

/** Tronque l'univers à la limite de symboles du plan WebSocket, benchmark inclus. */
export function capToWsLimit(
  instruments: Instrument[],
  benchmark: Instrument,
  limit: number
): Instrument[] {
  const hasBench = instruments.some((i) => i.symbol === benchmark.symbol);
  const all = hasBench ? instruments : [benchmark, ...instruments];
  return all.slice(0, Math.max(1, limit));
}
