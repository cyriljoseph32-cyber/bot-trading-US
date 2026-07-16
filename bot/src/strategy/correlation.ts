/* ─── Corrélation glissante (pur, testable) ────────────────────────────── */

/** Rendements simples d'une série de clôtures. */
export function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i - 1] !== 0 ? closes[i] / closes[i - 1] - 1 : 0);
  }
  return out;
}

/** Corrélation de Pearson entre deux séries de même longueur (null si indéfinie). */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xa = a.slice(-n);
  const xb = b.slice(-n);
  const ma = xa.reduce((s, v) => s + v, 0) / n;
  const mb = xb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = xa[i] - ma;
    const db = xb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

/** Corrélation des rendements sur la fenêtre `window` (bougies). */
export function rollingCorrelation(
  closesA: number[],
  closesB: number[],
  window: number
): number | null {
  const ra = returns(closesA).slice(-window);
  const rb = returns(closesB).slice(-window);
  return pearson(ra, rb);
}
