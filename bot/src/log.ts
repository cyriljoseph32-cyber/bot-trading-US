/* ─── Journal en anneau (exposé par l'API du dashboard) ────────────────────
 * Horodatage UTC ISO. Conserve les N derniers événements en mémoire et
 * relaie vers la console. Aucune donnée sensible ne doit être loggée.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string; // ISO UTC
  level: LogLevel;
  scope: string;
  msg: string;
}

const MAX_ENTRIES = 500;

export class RingLogger {
  private entries: LogEntry[] = [];

  log(level: LogLevel, scope: string, msg: string): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, scope, msg };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    const line = `${entry.ts} [${scope}] ${msg}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  debug(scope: string, msg: string): void { this.log("debug", scope, msg); }
  info(scope: string, msg: string): void { this.log("info", scope, msg); }
  warn(scope: string, msg: string): void { this.log("warn", scope, msg); }
  error(scope: string, msg: string): void { this.log("error", scope, msg); }

  /** Derniers événements (les plus récents en dernier). */
  recent(count = 100): LogEntry[] {
    return this.entries.slice(-count);
  }
}

export const logger = new RingLogger();
