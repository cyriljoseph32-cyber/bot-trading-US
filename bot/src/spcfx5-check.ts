/* ─── Vérification des tickers douteux (bot:spcfx5-check) ──────────────────
 *
 * bot/config/spcfx5.json contient 23 actifs désactivés avec la note
 * "[À VÉRIFIER CHEZ LE COURTIER]" ou "[À VÉRIFIER PAR CYRIL]" : leur symbole
 * Twelve Data n'a pas été confirmé (recherche web uniquement). Aucune page
 * de compte ne le dira — seule une requête à /symbol_search le dit.
 *
 * Ce script interroge /symbol_search pour chacun (1 crédit/appel, ~23 au
 * total, une seule fois) et affiche un tableau : existe / n'existe pas /
 * autre symbole trouvé. Il ne modifie JAMAIS la config — c'est à Cyril de
 * décider quoi activer, avec l'information en main.
 *
 * Usage : cp .env.example .env, renseigner TWELVEDATA_API_KEY, puis
 *   npm run bot:spcfx5-check
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./env";
import type { SpcAsset } from "./strategy/spcfx5/types";

const REST_URL = "https://api.twelvedata.com";

interface SymbolSearchHit {
  symbol: string;
  instrument_name?: string;
  exchange?: string;
  mic_code?: string;
  instrument_type?: string;
  country?: string;
}

interface SymbolSearchResponse {
  data?: SymbolSearchHit[];
  status?: string;
  message?: string;
}

export interface CheckResult {
  std: string;
  queried: string;
  verdict: "existe" | "n'existe pas" | "autre symbole trouvé" | "erreur";
  detail: string;
}

/** Compare la requête à un résultat /symbol_search (pur, testable). */
export function judgeMatch(queried: string, hits: SymbolSearchHit[]): CheckResult["verdict"] {
  if (hits.length === 0) return "n'existe pas";
  const norm = (s: string) => s.trim().toUpperCase();
  const exact = hits.some((h) => norm(h.symbol) === norm(queried));
  return exact ? "existe" : "autre symbole trouvé";
}

/** Résume les meilleures alternatives trouvées, pour affichage (pur). */
export function describeHits(hits: SymbolSearchHit[], limit = 3): string {
  if (hits.length === 0) return "—";
  return hits
    .slice(0, limit)
    .map((h) => `${h.symbol}${h.mic_code ? `:${h.mic_code}` : ""} (${h.instrument_name ?? h.instrument_type ?? "?"})`)
    .join(" | ");
}

/** Assets à vérifier : tous les actifs désactivés avec une note "À VÉRIFIER". */
function assetsToCheck(configPath: string): SpcAsset[] {
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as { assets: SpcAsset[] };
  return config.assets.filter((a) => !a.enabled && a.note?.includes("À VÉRIFIER"));
}

async function symbolSearch(query: string, apiKey: string): Promise<SymbolSearchHit[]> {
  const qs = new URLSearchParams({ symbol: query, apikey: apiKey });
  const res = await fetch(`${REST_URL}/symbol_search?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as SymbolSearchResponse;
  if (data.status === "error") throw new Error(data.message ?? "erreur API inconnue");
  return data.data ?? [];
}

/** Délai entre deux appels pour rester sous le plan gratuit (8 crédits/min → ~7.5s de marge). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.twelveDataApiKey) {
    console.error(
      "TWELVEDATA_API_KEY absente. Copiez .env.example en .env et renseignez votre clé avant de lancer ce script."
    );
    process.exitCode = 1;
    return;
  }

  const configPath = env.spcConfigPath ?? join(import.meta.dirname, "..", "config", "spcfx5.json");
  const targets = assetsToCheck(configPath);
  if (targets.length === 0) {
    console.log("Aucun actif marqué « À VÉRIFIER » dans la config — rien à faire.");
    return;
  }

  console.log(
    `${targets.length} actifs à vérifier via /symbol_search (~${targets.length} crédits, une seule fois).\n`
  );

  const results: CheckResult[] = [];
  const rpm = Math.max(1, env.tdRestRpm);
  const delayMs = Math.ceil(60_000 / rpm) + 500; // marge de sécurité sur le débit du plan

  for (const asset of targets) {
    const query = asset.provider;
    try {
      const hits = await symbolSearch(query, env.twelveDataApiKey);
      const verdict = judgeMatch(query, hits);
      results.push({ std: asset.std, queried: query, verdict, detail: describeHits(hits) });
    } catch (e) {
      results.push({ std: asset.std, queried: query, verdict: "erreur", detail: String(e) });
    }
    await sleep(delayMs);
  }

  const width = { std: 10, queried: 12, verdict: 22 };
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, Math.max(n, s.length));
  console.log(
    pad("Actif", width.std) + pad("Interrogé", width.queried) + pad("Verdict", width.verdict) + "Détail"
  );
  console.log("-".repeat(width.std + width.queried + width.verdict + 40));
  for (const r of results) {
    console.log(pad(r.std, width.std) + pad(r.queried, width.queried) + pad(r.verdict, width.verdict) + r.detail);
  }

  const existe = results.filter((r) => r.verdict === "existe").length;
  const absent = results.filter((r) => r.verdict === "n'existe pas").length;
  const autre = results.filter((r) => r.verdict === "autre symbole trouvé").length;
  const erreur = results.filter((r) => r.verdict === "erreur").length;
  console.log(
    `\nRésumé : ${existe} confirmés, ${autre} à corriger (voir détail), ${absent} introuvables, ${erreur} erreurs.`
  );
  console.log(
    "Rien n'a été modifié dans bot/config/spcfx5.json — à vous de décider quoi activer/corriger."
  );
}

// Ne s'exécute que si le fichier est lancé directement (pas en import de test).
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
