# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Signal Bot US** — a trading-signal bot for liquid US assets (SPY/QQQ/DIA/IWM + 16 large caps) implementing an RSI-2 mean-reversion strategy (enter when close > SMA200 and RSI(2) < 10; exit on close > SMA5, stop at entry − 2.5×ATR(14), or 10 sessions max; long only). It ships as a React dashboard plus Vercel Edge functions: a daily cron analyzes the watchlist after the US close, emails signals (Resend), optionally places orders at the broker (Alpaca, paper trading by default), and journals everything to Supabase. A Claude-powered chat endpoint (`/api/chat`) answers operator questions from that journal.

The project is French-language: comments, UI text, commit messages, and docs (README.md, DEPLOIEMENT.md) are all in French. Follow that convention.

## Commands

```bash
npm install --legacy-peer-deps   # what CI uses
npm run dev          # Vite dev server → http://localhost:5173/trading.html
npm run test:run     # all unit tests once (Vitest, node env)
npm run test         # watch mode
npx vitest run src/trading/risk.test.ts        # single test file
npx vitest run -t "kill switch"                # tests matching a name
npm run lint         # eslint .  (currently fails — see gotcha below)
npm run typecheck    # tsc --noEmit
npm run build        # tsc -b && vite build
```

CI (`.github/workflows/ci.yml`) runs lint + `test:run` + build on Node 22 for every push/PR. The "money" code (indicators, strategy, sizing, risk) must stay covered by tests.

There is no local server runtime for `api/` functions: in dev, Vite proxies `/api/market` straight to Yahoo Finance (`vite.config.ts`); the other endpoints only exist when deployed on Vercel.

## Architecture

The core design rule: **all money-path logic is pure and deterministic (no I/O, no env reads) in `src/trading/`, and all side effects live in `api/`**. The server imports the pure modules via relative paths (e.g. `api/cron.ts` imports `../src/trading/risk`), so the same strategy/risk code runs in the browser dashboard and in the cron.

### `src/trading/` — pure engine + dashboard UI

Pipeline: `indicators.ts` (SMA, Wilder RSI, ATR) → `strategy.ts` (RSI-2 rules, tunables in exported `PARAMS`, position sizing) → `backtest.ts` (metrics **net of commission + slippage**, `DEFAULT_COSTS`) → `detectors.ts` (6 setup detectors returning `present`/`strength`/`detail`) → `scoring.ts` (0–100 score combining technique + net win-rate + sentiment) → `risk.ts` (entry gate: kill switch, max daily loss, max positions/trades/day, concentration and gross-exposure caps).

Each of these has a colocated `*.test.ts`; every behavior change there needs a test. Key invariant in `risk.ts`: **entries can be halted, exits are never blocked** — closing a position always reduces risk.

UI: both `index.html` and `trading.html` load `src/trading/main.tsx` → `TradingApp.tsx` (with `Portfolio.tsx` and `Chat.tsx`). `data.ts` holds the `WATCHLIST` and fetches candles through `/api/market`. `auth.ts` stores the dashboard token in localStorage. `src/App.tsx` is the unused Vite template leftover.

### `api/` — Vercel **Edge** functions

All handlers declare `export const config = { runtime: "edge" }` and use web-standard `Request`/`Response` — **no Node-only APIs** (`fs`, `crypto` module, etc.).

- `api/market.ts` — validated proxy to Yahoo Finance daily candles.
- `api/cron.ts` — the daily job (scheduled in `vercel.json`, 21:35 UTC weekdays, protected by `CRON_SECRET`): analyze → exits driven by **real Alpaca positions** → entries as **limit orders with attached stop**, each gated by the risk engine → email → best-effort journaling (DB failures never block trading).
- `api/positions.ts`, `api/chat.ts` — dashboard endpoints, both require `DASHBOARD_TOKEN` (fail closed).
- `api/_lib/` — `engine.ts` (server-side `analyzeMarket()`, including data-freshness check: no orders if the last candle isn't from the current NY trading day), `alpaca.ts` (broker REST: bracket/limit/trailing orders), `email.ts` (Resend), `db.ts` (Supabase via REST with service-role key), `auth.ts` (constant-time bearer-token check; endpoints are open only until `DASHBOARD_TOKEN` is set), `env.ts`.

### Configuration & safety rails

`api/_lib/env.ts` is the **single point of `process.env` reads** — never read env vars directly elsewhere. Numeric params are validated and clamped (a typo falls back to a safe default). Safety defaults: Alpaca is paper trading unless `ALPACA_LIVE=true`; autotrading requires `AUTOTRADE=true`; buy slippage capped by `MAX_ENTRY_SLIPPAGE_PCT`. All variables are documented in `.env.example` and the README table.

Database schema lives in `supabase/migrations/0001_init.sql` (tables `runs`, `signals`, `orders`, `account_snapshots`, `config`; RLS enabled with no public policies — only the service-role key can read/write).

## Gotchas

- The repo previously had stray root-level duplicates of `src/trading/` and `api/` files (leftovers from bulk GitHub-web-UI uploads, some even mislabeled — e.g. root `env.example` contained `Portfolio.tsx`'s React code). These were removed; the canonical sources are `src/trading/`, `api/`, `supabase/migrations/`, and `.env.example`. If similar stray files reappear at the repo root after a future upload, delete them rather than editing them.
- `DEPLOIEMENT.md` is the changelog + deployment runbook, but the repo state can lag behind it (files arrive as bulk uploads) — trust the code over the doc when they disagree.
