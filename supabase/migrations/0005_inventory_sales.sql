-- ============================================================================
-- CopraBooks — Phase 2 schema: inventory (weighted average cost), traders
-- (buyers), truckload sales, and periodic stock counts.
--
-- Inventory is a derived projection of posted purchases, sales and stock
-- counts. `inventory_state` holds the running weighted-average position;
-- `inventory_movements` is an append-only log with per-movement balance
-- snapshots. Both are maintained by the SECURITY DEFINER functions in
-- 0006_inventory_functions.sql (incrementally on each transaction, and fully
-- via rebuild_inventory() for backfill / repair).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Running inventory position (one row per business)
-- ----------------------------------------------------------------------------
create table public.inventory_state (
  business_id          uuid primary key references public.businesses (id) on delete cascade,
  qty_on_hand_kg       numeric(12,2) not null default 0,
  total_value_centavos bigint not null default 0,
  avg_cost_centavos    numeric(14,4) not null default 0,
  updated_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Append-only movement log (derived; carries balance snapshots)
-- ----------------------------------------------------------------------------
create table public.inventory_movements (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  movement_type        text not null check (movement_type in
                         ('purchase_in', 'purchase_void', 'sale_out', 'shrinkage',
                          'count_adj', 'sale_void')),
  qty_kg               numeric(12,2) not null,            -- signed (+ in, - out)
  unit_cost_centavos   numeric(14,4),
  total_cost_centavos  bigint not null,                   -- signed
  source_type          text not null,
  source_id            uuid,
  balance_qty_after    numeric(12,2) not null,
  balance_value_after  bigint not null,
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
create index inventory_movements_biz_idx
  on public.inventory_movements (business_id, occurred_at);

-- ----------------------------------------------------------------------------
-- Traders we sell truckloads to (Module 6)
-- ----------------------------------------------------------------------------
create table public.buyers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  contact     text,
  notes       text,
  active      boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

-- ----------------------------------------------------------------------------
-- Truckload sales (Module 6)
--   Revenue is amount_received_centavos. Cost of sales, shrinkage and the
--   effective book_kg drawn are derived by the posting function from the
--   weighted-average cost at the time of sale.
--   shrinkage_kg = book_kg - our_loaded_kg  (phantom book weight written off)
--   profit = amount_received - cost_of_sales - trucking - labor - other
-- ----------------------------------------------------------------------------
create table public.sales (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses (id) on delete cascade,
  sale_no                  bigint not null,
  buyer_id                 uuid references public.buyers (id),
  sale_date                date not null default (now() at time zone 'Asia/Manila')::date,
  plate_no                 text,
  driver                   text,
  our_loaded_kg            numeric(12,2) not null check (our_loaded_kg >= 0),
  our_avg_deduction_pct    numeric(5,2) not null default 0,
  buyer_gross_kg           numeric(12,2),
  buyer_deduction_pct      numeric(5,2),
  buyer_net_kg             numeric(12,2),
  price_per_kg_centavos    bigint not null default 0 check (price_per_kg_centavos >= 0),
  amount_received_centavos bigint not null check (amount_received_centavos >= 0),
  payment_method           text check (payment_method in ('cash', 'bank', 'gcash')),
  trucking_centavos        bigint not null default 0 check (trucking_centavos >= 0),
  labor_centavos           bigint not null default 0 check (labor_centavos >= 0),
  other_expenses_centavos  bigint not null default 0 check (other_expenses_centavos >= 0),
  book_kg                  numeric(12,2) not null default 0,   -- derived (effective draw)
  shrinkage_kg             numeric(12,2) not null default 0,   -- derived
  shrinkage_flag           boolean not null default false,     -- derived
  cost_of_sales_centavos   bigint not null default 0,          -- derived
  shrinkage_value_centavos bigint not null default 0,          -- derived
  remarks                  text,
  status                   text not null default 'posted' check (status in ('posted', 'voided')),
  created_by               uuid references public.profiles (id),
  created_at               timestamptz not null default now(),
  voided_by                uuid references public.profiles (id),
  void_reason              text,
  voided_at                timestamptz,
  unique (business_id, sale_no)
);
create index sales_biz_date_idx on public.sales (business_id, sale_date desc);

-- ----------------------------------------------------------------------------
-- Periodic physical stock count (owner only) — optional adjustment
-- ----------------------------------------------------------------------------
create table public.stock_counts (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses (id) on delete cascade,
  count_date                date not null default (now() at time zone 'Asia/Manila')::date,
  counted_kg                numeric(12,2) not null check (counted_kg >= 0),
  book_kg                   numeric(12,2) not null default 0,       -- derived (on-hand before)
  variance_kg               numeric(12,2) not null default 0,       -- derived (counted - book)
  adjustment_value_centavos bigint not null default 0,              -- derived (signed)
  remarks                   text,
  status                    text not null default 'posted' check (status in ('posted', 'voided')),
  created_by                uuid references public.profiles (id),
  created_at                timestamptz not null default now()
);
create index stock_counts_biz_idx on public.stock_counts (business_id, count_date desc);
