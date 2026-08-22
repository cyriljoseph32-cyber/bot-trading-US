/* ─── Persistance des bougies et signaux ───────────────────────────────────
 *
 * Interface unique + deux implémentations :
 *   • MemoryStore : tests et backtests ;
 *   • JsonlStore  : append JSONL par jour et par type (léger, sans dépendance).
 * Le schéma Postgres équivalent est fourni dans
 * supabase/migrations/0002_market_data.sql pour une persistance en base.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Bar, ScoredSignal, OrderResult } from "./types";

export interface Store {
  saveBar(bar: Bar): void;
  saveSignal(signal: ScoredSignal): void;
  saveOrder(order: OrderResult): void;
  /** Enregistrement libre, typé par `kind` (stratégies additionnelles : SPC FX5…). */
  saveRecord(kind: string, record: unknown): void;
}

export class MemoryStore implements Store {
  bars: Bar[] = [];
  signals: ScoredSignal[] = [];
  orders: OrderResult[] = [];
  records: Array<{ kind: string; record: unknown }> = [];

  saveBar(bar: Bar): void { this.bars.push(bar); }
  saveSignal(signal: ScoredSignal): void { this.signals.push(signal); }
  saveOrder(order: OrderResult): void { this.orders.push(order); }
  saveRecord(kind: string, record: unknown): void { this.records.push({ kind, record }); }
}

export class JsonlStore implements Store {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private append(kind: string, record: unknown): void {
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(this.dir, `${kind}-${day}.jsonl`), JSON.stringify(record) + "\n");
  }

  saveBar(bar: Bar): void { this.append("bars", bar); }
  saveSignal(signal: ScoredSignal): void { this.append("signals", signal); }
  saveOrder(order: OrderResult): void { this.append("orders", order); }
  saveRecord(kind: string, record: unknown): void { this.append(kind, record); }
}
