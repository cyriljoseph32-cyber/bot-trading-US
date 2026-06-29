import { runStrategy, type Candle, type Trade } from "./strategy";

/* ─── Backtest avancé (pur, testable) ──────────────────────────────────────
 *
 * Reprend les trades produits par la stratégie et calcule des métriques
 * RÉALISTES en intégrant frais et slippage (le backtest naïf d'origine les
 * ignorait, ce qui surestimait la performance). Une position à la fois.
 *
 * Métriques : rendement total composé, win-rate, profit factor, drawdown max,
 * Sharpe (par trade), espérance par trade.
 */

export interface BacktestCosts {
  /** Commission par côté, en % du prix (ex. 0 chez Alpaca actions US). */
  commissionPct: number;
  /** Slippage estimé par côté, en % (exécution moins bonne que prévue). */
  slippagePct: number;
}

export const DEFAULT_COSTS: BacktestCosts = { commissionPct: 0, slippagePct: 0.05 };

export interface BacktestMetrics {
  trades: number;
  winRate: number | null; // 0..1
  totalReturnPct: number; // rendement composé net
  avgWinPct: number | null;
  avgLossPct: number | null;
  expectancyPct: number | null; // pnl net moyen par trade
  profitFactor: number | null; // gains bruts / pertes brutes
  maxDrawdownPct: number; // drawdown max de la courbe d'equity
  sharpe: number | null; // par trade (mean/écart-type des rendements nets)
  finalEquity: number; // base 1.0
  netReturns: number[]; // rendement net par trade (fraction)
}

/** Coût aller-retour en fraction (entrée + sortie). */
function roundTripCost(costs: BacktestCosts): number {
  return (2 * (costs.commissionPct + costs.slippagePct)) / 100;
}

export function backtest(trades: Trade[], costs: BacktestCosts = DEFAULT_COSTS): BacktestMetrics {
  const rt = roundTripCost(costs);
  const netReturns: number[] = [];
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let grossWin = 0;
  let grossLoss = 0; // valeur absolue
  const wins: number[] = [];
  const losses: number[] = [];

  for (const t of trades) {
    const gross = t.exitPrice / t.entryPrice - 1;
    const net = gross - rt;
    netReturns.push(net);
    equity *= 1 + net;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
    if (net > 0) {
      grossWin += net;
      wins.push(net);
    } else {
      grossLoss += -net;
      losses.push(net);
    }
  }

  const n = trades.length;
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const expectancy = mean(netReturns);

  let sharpe: number | null = null;
  if (n > 1 && expectancy != null) {
    const variance = netReturns.reduce((s, r) => s + (r - expectancy) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? expectancy / std : null;
  }

  return {
    trades: n,
    winRate: n ? wins.length / n : null,
    totalReturnPct: (equity - 1) * 100,
    avgWinPct: avgWin != null ? avgWin * 100 : null,
    avgLossPct: avgLoss != null ? avgLoss * 100 : null,
    expectancyPct: expectancy != null ? expectancy * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdownPct: maxDd * 100,
    sharpe,
    finalEquity: equity,
    netReturns,
  };
}

/** Pratique : exécute la stratégie sur les bougies puis backteste ses trades. */
export function backtestStrategy(
  candles: Candle[],
  costs: BacktestCosts = DEFAULT_COSTS
): BacktestMetrics | null {
  const r = runStrategy(candles);
  if (!r) return null;
  return backtest(r.trades, costs);
}
