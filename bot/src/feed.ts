/* ─── Machinerie de connexion du flux (parties pures, testables) ───────────
 *
 * La logique reconnexion/backoff/heartbeat est isolée ici sous forme de
 * fonctions et petites classes SANS socket : le provider (twelvedata.ts) les
 * pilote, les tests les vérifient sans réseau.
 */

/** Backoff exponentiel plafonné avec jitter déterministe optionnel. */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** 0..1 — proportion de jitter aléatoire ajoutée (0 = déterministe). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 1000, maxMs: 60_000, jitter: 0.2 };

/** Délai avant la tentative n° `attempt` (0 = première reconnexion). */
export function backoffDelayMs(
  attempt: number,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random
): number {
  const raw = Math.min(opts.baseMs * 2 ** attempt, opts.maxMs);
  return Math.round(raw * (1 + opts.jitter * random()));
}

/** Surveillance de heartbeat : le flux est mort si plus rien depuis `timeoutMs`. */
export class HeartbeatMonitor {
  private lastEventTs: number;

  constructor(private readonly timeoutMs: number, now: number = Date.now()) {
    this.lastEventTs = now;
  }

  /** À appeler sur CHAQUE message reçu (cotation ou heartbeat). */
  touch(now: number = Date.now()): void {
    this.lastEventTs = now;
  }

  isDead(now: number = Date.now()): boolean {
    return now - this.lastEventTs > this.timeoutMs;
  }

  msSinceLastEvent(now: number = Date.now()): number {
    return now - this.lastEventTs;
  }
}

/** Découpe une liste de symboles en lots pour les messages de souscription. */
export function chunkSymbols(symbols: string[], batchSize: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    out.push(symbols.slice(i, i + batchSize));
  }
  return out;
}

/* ─── Limiteur de débit REST (token bucket à la minute) ────────────────── */

export class RateLimiter {
  private tokens: number;
  private windowStart: number;

  constructor(private readonly perMinute: number, now: number = Date.now()) {
    this.tokens = perMinute;
    this.windowStart = now;
  }

  /** Consomme un crédit si disponible ; sinon renvoie le délai d'attente (ms). */
  tryAcquire(now: number = Date.now()): { ok: boolean; retryInMs: number } {
    if (now - this.windowStart >= 60_000) {
      this.tokens = this.perMinute;
      this.windowStart = now;
    }
    if (this.tokens > 0) {
      this.tokens -= 1;
      return { ok: true, retryInMs: 0 };
    }
    return { ok: false, retryInMs: this.windowStart + 60_000 - now };
  }

  /** Attend qu'un crédit soit disponible puis le consomme. */
  async acquire(now: () => number = Date.now): Promise<void> {
    for (;;) {
      const res = this.tryAcquire(now());
      if (res.ok) return;
      await new Promise((r) => setTimeout(r, Math.max(res.retryInMs, 50)));
    }
  }
}
