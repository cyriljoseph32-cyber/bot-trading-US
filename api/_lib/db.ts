/* ─── Couche d'accès Supabase (journal de trades) ──────────────────────────
 *
 * Accès via l'API REST PostgREST de Supabase (pas de dépendance npm, compatible
 * runtime "edge"). Clé service_role → contourne RLS (usage serveur uniquement).
 *
 * Principe DIRECTEUR : le journal ne doit JAMAIS faire échouer le trading.
 * Toutes les écritures sont "best-effort" : si Supabase n'est pas configuré ou
 * répond une erreur, on logge et on continue. Aucune exception ne remonte.
 *
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { str } from "./env";

export function dbConfigured(): boolean {
  return Boolean(str("SUPABASE_URL") && str("SUPABASE_SERVICE_ROLE_KEY"));
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  const key = str("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}

/** INSERT générique. `returning` renvoie les lignes insérées (sinon minimal). */
async function insert<T>(
  table: string,
  rows: unknown,
  returning = false
): Promise<T[] | null> {
  if (!dbConfigured()) return null;
  const base = str("SUPABASE_URL")!.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/rest/v1/${table}`, {
      method: "POST",
      headers: headers({
        prefer: returning ? "return=representation" : "return=minimal",
      }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      console.error(`[db] ${table} HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    return returning ? ((await res.json()) as T[]) : [];
  } catch (e) {
    console.error(`[db] ${table} erreur réseau:`, e);
    return null;
  }
}

/* ─── Types des lignes journalisées ──────────────────────────────────────── */

export interface RunRow {
  analysed: number;
  buys: number;
  sells: number;
  holds: number;
  autotrade: boolean;
  live: boolean;
  email_status?: string;
  errors?: unknown[];
}

export interface SignalRowDb {
  run_id: string | null;
  symbol: string;
  action: string;
  trend?: string | null;
  last_close?: number | null;
  rsi2?: number | null;
  rsi14?: number | null;
  sma200?: number | null;
  entry?: number | null;
  stop?: number | null;
  win_rate?: number | null;
  exit_reason?: string | null;
}

export interface OrderRow {
  run_id: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty?: number | null;
  type?: string | null;
  stop_price?: number | null;
  broker_order_id?: string | null;
  status?: string | null;
  live: boolean;
  error?: string | null;
  raw?: unknown;
}

export interface SnapshotRow {
  equity?: number | null;
  cash?: number | null;
  buying_power?: number | null;
  live: boolean;
  positions?: unknown[];
}

/* ─── Helpers d'écriture (best-effort) ───────────────────────────────────── */

/** Crée un run et renvoie son id (ou null si DB non configurée/erreur). */
export async function insertRun(row: RunRow): Promise<string | null> {
  const out = await insert<{ id: string }>("runs", row, true);
  return out && out[0] ? out[0].id : null;
}

export async function insertSignals(rows: SignalRowDb[]): Promise<void> {
  if (rows.length) await insert("signals", rows);
}

export async function insertOrders(rows: OrderRow[]): Promise<void> {
  if (rows.length) await insert("orders", rows);
}

export async function insertSnapshot(row: SnapshotRow): Promise<void> {
  await insert("account_snapshots", row);
}

/* ─── Lecture (pour l'assistant /api/chat) ───────────────────────────────── */

/** SELECT générique best-effort : renvoie [] si DB absente ou erreur. */
async function select<T>(table: string, query: string): Promise<T[]> {
  if (!dbConfigured()) return [];
  const base = str("SUPABASE_URL")!.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: headers(),
    });
    if (!res.ok) {
      console.error(`[db] select ${table} HTTP ${res.status}: ${await res.text()}`);
      return [];
    }
    return (await res.json()) as T[];
  } catch (e) {
    console.error(`[db] select ${table} erreur réseau:`, e);
    return [];
  }
}

type Row = Record<string, unknown>;

export const fetchLatestSignals = (limit = 40): Promise<Row[]> =>
  select<Row>("signals", `select=*&order=created_at.desc&limit=${limit}`);

export const fetchRecentOrders = (limit = 20): Promise<Row[]> =>
  select<Row>("orders", `select=*&order=created_at.desc&limit=${limit}`);

export const fetchRecentRuns = (limit = 5): Promise<Row[]> =>
  select<Row>("runs", `select=*&order=created_at.desc&limit=${limit}`);
