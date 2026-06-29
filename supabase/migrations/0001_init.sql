-- ════════════════════════════════════════════════════════════════════════
--  Signal Bot US — schéma initial (Phase 0.4)
--  À exécuter dans Supabase → SQL Editor → New query → Run.
--
--  Objectif : historiser chaque analyse, chaque signal et chaque ordre, plus
--  des instantanés du compte courtier. C'est la fondation du futur dashboard
--  de performance (win rate réel, profit factor, drawdown, courbe d'equity).
--
--  Sécurité : RLS activé sans aucune policy publique → seules les fonctions
--  serveur (clé service_role, qui contourne RLS) peuvent lire/écrire. La clé
--  anon publique ne voit RIEN.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;  -- pour gen_random_uuid()

-- ─── runs : une ligne par exécution du cron / analyse de marché ───────────
create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  analysed      int  not null default 0,
  buys          int  not null default 0,
  sells         int  not null default 0,
  holds         int  not null default 0,
  autotrade     boolean not null default false,
  live          boolean not null default false,
  email_status  text,
  errors        jsonb not null default '[]'::jsonb
);

-- ─── signals : un signal par actif et par run ─────────────────────────────
create table if not exists public.signals (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references public.runs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  symbol      text not null,
  action      text not null,                 -- ACHETER | VENDRE | CONSERVER | ATTENDRE
  score       numeric,                       -- réservé Phase 4 (scoring 0–100)
  trend       text,                          -- haussier | baissier
  last_close  numeric,
  rsi2        numeric,
  rsi14       numeric,
  sma200      numeric,
  entry       numeric,                       -- plan d'entrée si ACHETER
  stop        numeric,
  win_rate    numeric,                       -- taux backtest historique 0..1
  exit_reason text                           -- objectif | stop | temps (si VENDRE)
);
create index if not exists signals_symbol_idx on public.signals (symbol);
create index if not exists signals_created_idx on public.signals (created_at desc);

-- ─── orders : chaque ordre passé chez le courtier (journal de trades) ──────
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid references public.runs(id) on delete set null,
  created_at       timestamptz not null default now(),
  symbol           text not null,
  side             text not null,            -- buy | sell
  qty              numeric,
  type             text,                     -- market | limit | stop ...
  stop_price       numeric,
  take_profit      numeric,                  -- réservé Phase 1 (OCO/TP)
  broker_order_id  text,                     -- id Alpaca, pour réconciliation
  status           text,                     -- ok | failed | <statut Alpaca>
  filled_avg_price numeric,
  live             boolean not null default false,
  error            text,                     -- message si échec
  raw              jsonb                     -- réponse brute du courtier (debug)
);
create index if not exists orders_symbol_idx on public.orders (symbol);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_broker_idx on public.orders (broker_order_id);

-- ─── account_snapshots : photo du compte à chaque run (courbe d'equity) ────
create table if not exists public.account_snapshots (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  equity        numeric,
  cash          numeric,
  buying_power  numeric,
  live          boolean not null default false,
  positions     jsonb not null default '[]'::jsonb  -- positions au moment T
);
create index if not exists snapshots_created_idx on public.account_snapshots (created_at desc);

-- ─── config : paramètres runtime (réservé Phase 1 — moteur de risque) ──────
create table if not exists public.config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ─── Verrouillage RLS : aucune policy publique = accès serveur uniquement ──
alter table public.runs              enable row level security;
alter table public.signals           enable row level security;
alter table public.orders            enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.config            enable row level security;

-- (Aucune policy créée volontairement : la clé service_role contourne RLS,
--  la clé anon publique n'a donc aucun accès. Sécurisé par défaut.)
