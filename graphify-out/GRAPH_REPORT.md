# Graph Report - bot-trading-US  (2026-08-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 783 nodes · 1938 edges · 36 communities (22 shown, 11 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e7417e02`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32

## God Nodes (most connected - your core abstractions)
1. `main()` - 37 edges
2. `Quote` - 33 edges
3. `Bar` - 30 edges
4. `PaperBroker` - 29 edges
5. `PortfolioGovernor` - 28 edges
6. `Instrument` - 27 edges
7. `RiskEngine` - 26 edges
8. `main()` - 25 edges
9. `evaluateSpcFx5()` - 24 edges
10. `handler()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `volumeFilter()` --calls--> `sma()`  [EXTRACTED]
  bot/src/strategy/spcfx5/filters.ts → src/trading/indicators.ts
- `utBot()` --calls--> `atr()`  [EXTRACTED]
  bot/src/strategy/spcfx5/indicators.ts → src/trading/indicators.ts
- `higherTfTrend()` --calls--> `sma()`  [EXTRACTED]
  bot/src/strategy/spcfx5/mtf.ts → src/trading/indicators.ts
- `evaluateSpcFx5()` --calls--> `sma()`  [EXTRACTED]
  bot/src/strategy/spcfx5/signal.ts → src/trading/indicators.ts
- `detectRegime()` --calls--> `atr()`  [EXTRACTED]
  bot/src/strategy/pipeline.ts → src/trading/indicators.ts

## Import Cycles
- None detected.

## Communities (36 total, 11 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (61): LogEntry, logger, LogLevel, dayKey(), DEFAULT_SPC_PORTFOLIO, EntryCandidate, PortfolioDecision, PortfolioGovernor (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (73): aggregateHigherTf(), BreakoutResult, confirmBreakout(), antiChopFilter(), assetCurrencies(), CostEstimate, costFilter(), estimateCost() (+65 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (64): analyzeMarket(), fetchYahooCandles(), isSameNyDay(), SignalRow, YahooChart, App(), backtest(), BacktestCosts (+56 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (70): config, fmt(), handler(), rateLimited(), rlBucket, summarizeContext(), config, handler() (+62 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (27): backoffDelayMs(), BackoffOptions, chunkSymbols(), DEFAULT_BACKOFF, HeartbeatMonitor, RateLimiter, FeedStatus, MarketDataProvider (+19 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (21): BlendedRecommendation, BlendResult, clamp01(), CohortBreakdownEntry, CohortMetrics, CohortRecommendations, Direction, historyEntry() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (16): DEFAULT_GLOBAL_RISK, EntryContext, exposure(), GlobalRiskParams, RiskDecision, RiskEngine, RiskReject, round4() (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (13): BrokerAdapter, DEFAULT_PAPER_COSTS, PaperCosts, round4(), OrderRouter, OrderRequest, OrderResult, Quote (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (11): BarAggregator, BarCloseEvent, newBar(), OUTLIER_MOVE_PCT, Bar, SPC_TIMEFRAMES, TF_MS, Timeframe (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (17): SIGNAL_TF, json(), readBody(), SpcFx5State, startServer(), handle(), Instrument, capToWsLimit() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (22): src, vite/client, compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (18): BacktestResult, loadBars(), main(), quoteFromBar(), syntheticBars(), detectRegime(), evaluate(), last() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (21): bot, src/trading/indicators.ts, compilerOptions, lib, module, moduleDetection, moduleResolution, noEmit (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (20): vite.config.ts, compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (5): BotState, JsonlStore, MemoryStore, Store, ScoredSignal

### Community 15 - "Community 15"
Cohesion: 0.22
Nodes (7): runBacktest(), PaperBroker, round2(), main(), broker(), fakeLive(), paper()

### Community 16 - "Community 16"
Cohesion: 0.20
Nodes (13): BotEnv, flag(), loadEnv(), num(), assetsToCheck(), CheckResult, describeHits(), judgeMatch() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (15): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, tsx (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (11): authedFetch(), getToken(), setToken(), C, Chat(), Msg, badge(), C (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (14): scripts, bot:backtest, bot:dev, bot:paper, bot:spcfx5, bot:spcfx5-backtest, bot:spcfx5-check, build (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (9): dependencies, react, react-dom, name, private, type, version, react (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.83
Nodes (3): pearson(), returns(), rollingCorrelation()

## Knowledge Gaps
- **195 isolated node(s):** `LogEntry`, `LogLevel`, `SpcPortfolioReject`, `ManageResult`, `CategoryConfig` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 250 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `atr()` connect `Community 2` to `Community 0`, `Community 1`, `Community 9`, `Community 11`, `Community 15`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Why does `sma()` connect `Community 2` to `Community 1`, `Community 11`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `main()` connect `Community 15` to `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 11`, `Community 14`, `Community 16`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `main()` (e.g. with `.flushExpired()` and `.getBars()`) actually correct?**
  _`main()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `LogEntry`, `LogLevel`, `SpcPortfolioReject` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05641025641025641 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._