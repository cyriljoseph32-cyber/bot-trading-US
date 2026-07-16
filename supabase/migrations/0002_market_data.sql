-- ════════════════════════════════════════════════════════════════════════
--  Bot global multi-actifs — persistance optionnelle en Postgres/Supabase.
--  Le bot persiste en JSONL local par défaut (bot/src/store.ts) ; ce schéma
--  est l'équivalent en base pour qui veut brancher un Store Postgres.
--  Sécurité : RLS activé sans policy publique, comme 0001_init.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ─── bars : bougies 1m/5m/15m normalisées ─────────────────────────────────
create table if not exists public.bars (
  symbol     text        not null,
  tf         text        not null,               -- 1m | 5m | 15m
  open_time  timestamptz not null,               -- début de bougie, UTC
  open       numeric     not null,
  high       numeric     not null,
  low        numeric     not null,
  close      numeric     not null,
  volume     numeric     not null default 0,
  ticks      int         not null default 0,
  outlier    boolean     not null default false, -- variation aberrante
  gap_before boolean     not null default false, -- trou de données avant
  primary key (symbol, tf, open_time)            -- déduplication native
);
create index if not exists bars_symbol_tf_idx on public.bars (symbol, tf, open_time desc);

-- ─── bot_signals : signaux notés du pipeline (score/confiance/raisons) ─────
create table if not exists public.bot_signals (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  symbol      text    not null,
  asset_class text    not null,                  -- equity | fx | crypto
  tf          text    not null,
  side        text    not null,                  -- long | short | flat
  score       numeric not null,
  confidence  numeric not null,
  reasons     jsonb   not null default '[]'::jsonb,
  parts       jsonb   not null default '[]'::jsonb,
  price       numeric,
  signal_ts   timestamptz
);
create index if not exists bot_signals_symbol_idx on public.bot_signals (symbol, created_at desc);

-- ─── bot_orders : journal des ordres (papier ou réel) ──────────────────────
create table if not exists public.bot_orders (
  client_order_id text primary key,              -- clé d'idempotence
  created_at      timestamptz not null default now(),
  status          text    not null,              -- filled | rejected | duplicate
  fill_price      numeric,
  qty             numeric,
  reason          text
);

-- ─── Verrouillage RLS : accès serveur uniquement (service_role) ────────────
alter table public.bars        enable row level security;
alter table public.bot_signals enable row level security;
alter table public.bot_orders  enable row level security;
