/* ─── Univers SPC FX5 : watchlist modulaire et mapping courtier ────────────
 *
 * RÈGLE : on ne suppose JAMAIS qu'un ticker existe chez le courtier. La
 * watchlist est un fichier JSON éditable où chaque actif porte deux symboles —
 * `std` (standard, celui dont on parle) et `provider` (celui que l'API attend).
 * Un actif indisponible se met à `enabled: false` ; le reste du système ne le
 * voit plus, et la raison reste visible sur /api/spcfx5/universe.
 */

import { readFileSync } from "node:fs";
import type { AssetClass, Instrument } from "../../types";
import type { Direction, SpcCategory, SpcParams } from "./params";
import type { SpcPortfolioParams } from "../../risk/portfolio";
import type { GroupBet, SpcAsset, SpcSkipReason, SpcUniverseResult } from "./types";

const CATEGORIES: SpcCategory[] = [
  "fx_major",
  "fx_minor",
  "fx_exotic",
  "index",
  "metal",
  "energy",
  "agriculture",
  "equity",
  "etf",
  "crypto",
];

/** Bande de volatilité et coût moyen appliqués à toute une catégorie. */
export interface CategoryConfig {
  minAtrPct?: number;
  maxAtrPct?: number;
  costBps?: number;
}

export interface SpcConfig {
  /** Surcharges de paramètres de stratégie (fusionnées avec les défauts). */
  params?: Partial<SpcParams>;
  /** Surcharges des plafonds portefeuille. */
  portfolio?: Partial<SpcPortfolioParams>;
  /** Réglages par catégorie d'actifs. */
  categories?: Partial<Record<SpcCategory, CategoryConfig>>;
  /** Plafonds de risque par groupe corrélé (% de l'equity). */
  correlationGroups?: Record<string, { maxRiskPct: number; label?: string }>;
  assets: SpcAsset[];
}

export function loadSpcConfig(path: string): SpcConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as SpcConfig;
}

function instrumentOf(asset: SpcAsset): Instrument {
  return {
    symbol: asset.provider,
    name: asset.name ?? asset.std,
    assetClass: asset.assetClass as AssetClass,
    exchange: asset.exchange,
    currency: asset.currency,
    country: asset.country,
    sector: asset.sector,
    region: asset.category,
  };
}

/**
 * Construit la watchlist effective :
 *   1. actifs désactivés ignorés ;
 *   2. catégories inconnues ignorées (config erronée, jamais devinée) ;
 *   3. doublons de symbole fournisseur ignorés ;
 *   4. troncature au plafond de symboles (crédits API).
 * Chaque exclusion est renvoyée avec sa raison — rien ne disparaît en silence.
 */
export function selectSpcUniverse(config: SpcConfig, maxSymbols: number): SpcUniverseResult {
  const selected: SpcUniverseResult["selected"] = [];
  const skipped: Array<{ std: string; reason: SpcSkipReason }> = [];
  const seen = new Set<string>();

  for (const asset of config.assets) {
    if (!asset.enabled) {
      skipped.push({ std: asset.std, reason: "disabled" });
      continue;
    }
    if (!CATEGORIES.includes(asset.category)) {
      skipped.push({ std: asset.std, reason: "unknown_category" });
      continue;
    }
    const key = asset.provider.toUpperCase();
    if (seen.has(key)) {
      skipped.push({ std: asset.std, reason: "duplicate_symbol" });
      continue;
    }
    if (selected.length >= maxSymbols) {
      skipped.push({ std: asset.std, reason: "over_symbol_cap" });
      continue;
    }
    seen.add(key);
    selected.push({ asset, instrument: instrumentOf(asset) });
  }

  return { selected, skipped };
}

/**
 * Décode une référence de groupe `"usd:-1"` → groupe + signe du pari.
 * Signe +1 : être long cet actif revient à être long le thème du groupe.
 * Signe -1 : être long cet actif revient à être SHORT le thème.
 * Sans suffixe, le signe vaut +1.
 */
export function parseGroupRef(ref: string): { group: string; sign: 1 | -1 } {
  const [group, rawSign] = ref.split(":");
  const sign = rawSign?.trim() === "-1" ? -1 : 1;
  return { group: group.trim(), sign };
}

/**
 * Paris de groupe portés par une position. C'est ce qui permet de voir que
 * « long EURUSD » et « short USDCHF » sont le même pari sur la baisse du
 * dollar, et donc de ne pas empiler deux fois le même risque.
 */
export function groupBets(asset: SpcAsset, direction: Direction): GroupBet[] {
  return asset.groups.map((ref) => {
    const { group, sign } = parseGroupRef(ref);
    const betDirection: Direction =
      sign === 1 ? direction : direction === "long" ? "short" : "long";
    return { group, direction: betDirection };
  });
}

/** Bande de volatilité effective d'un actif (catégorie, puis défauts). */
export function volatilityBandOf(
  asset: SpcAsset,
  config: SpcConfig
): { minAtrPct?: number; maxAtrPct?: number } | undefined {
  const cat = config.categories?.[asset.category];
  if (!cat) return undefined;
  return { minAtrPct: cat.minAtrPct, maxAtrPct: cat.maxAtrPct };
}

/** Coût aller-retour de l'actif : valeur propre, puis catégorie, puis défaut. */
export function costBpsOf(asset: SpcAsset, config: SpcConfig): number | undefined {
  return asset.costBps ?? config.categories?.[asset.category]?.costBps;
}

/** Plafonds de risque par groupe, au format attendu par le gouverneur. */
export function correlationOverrides(config: SpcConfig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [group, cfg] of Object.entries(config.correlationGroups ?? {})) {
    out[group] = cfg.maxRiskPct;
  }
  return out;
}
