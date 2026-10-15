-- ============================================================================
-- CopraBooks — Phase 1 core schema
-- Auth/roles, settings, document counters, audit log, pricing, farmers,
-- utang (farmer advances) ledger, purchases.
--
-- Conventions:
--   * Money is stored as BIGINT centavos (no floats).
--   * Weights are NUMERIC(12,2) kilograms.
--   * Every business table carries business_id (single business now, multi
--     tenant later). RLS is enabled in 0002_rls.sql.
--   * Financial records (utang_ledger, purchases) are append-only; corrections
--     are reversals, never deletes. Clients get SELECT only; all writes go
--     through SECURITY DEFINER functions (0003_functions.sql).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Businesses & people
-- ----------------------------------------------------------------------------
create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  tz          text not null default 'Asia/Manila',
  currency    text not null default 'PHP',
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id),
  role        text not null default 'cashier' check (role in ('owner', 'cashier')),
  full_name   text,
  created_at  timestamptz not null default now()
);
create index profiles_business_idx on public.profiles (business_id);

create table public.business_settings (
  business_id                 uuid primary key references public.businesses (id) on delete cascade,
  shrinkage_threshold_pct     numeric(5,2) not null default 3.00,
  advance_approval_limit_centavos bigint not null default 500000, -- ₱5,000
  receipt_header              jsonb not null default '{}'::jsonb,
  updated_at                  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Sequential, never-reused document numbers (receipts, etc.)
-- ----------------------------------------------------------------------------
create table public.document_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  doc_type    text not null,
  next_number bigint not null default 1,
  primary key (business_id, doc_type)
);

-- ----------------------------------------------------------------------------
-- Audit trail (who / when / what / why)
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_id    uuid references public.profiles (id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_business_idx on public.audit_log (business_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Pricing (Module 1)
-- ----------------------------------------------------------------------------
create table public.grades (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

create table public.buying_prices (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  effective_date         date not null,
  grade_id               uuid references public.grades (id),
  price_per_kg_centavos  bigint not null check (price_per_kg_centavos >= 0),
  set_by                 uuid references public.profiles (id),
  created_at             timestamptz not null default now()
);
-- One price per (date, grade). NULL grade = single/ungraded price.
create unique index buying_prices_date_grade_idx
  on public.buying_prices (business_id, effective_date, coalesce(grade_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.buyer_reference_prices (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  effective_date         date not null,
  price_per_kg_centavos  bigint not null check (price_per_kg_centavos >= 0),
  set_by                 uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  unique (business_id, effective_date)
);

-- ----------------------------------------------------------------------------
-- Farmers (Module 2)
-- ----------------------------------------------------------------------------
create table public.farmers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  barangay    text,
  mobile      text,
  notes       text,
  active      boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index farmers_business_idx on public.farmers (business_id);

-- ----------------------------------------------------------------------------
-- Utang / farmer advances ledger (Module 4)
--   Append-only. Balance = SUM(advance) - SUM(repayment) over POSTED rows.
--   direction: 'advance'   -> increases what the farmer owes us
--              'repayment'  -> decreases it
--   source:    'cash_advance'      (cash handed out)
--              'purchase_deduction'(repaid out of a purchase)
--              'direct_cash'        (farmer pays cash directly)
--              'adjustment'         (owner manual adjustment)
--              'void'               (reversal of a voided purchase deduction)
--   status:    'pending' (advance over the approval limit, awaiting owner)
--              'posted'  (effective)
--              'rejected'(owner declined)
-- ----------------------------------------------------------------------------
create table public.utang_ledger (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  farmer_id       uuid not null references public.farmers (id),
  entry_date      date not null default (now() at time zone 'Asia/Manila')::date,
  direction       text not null check (direction in ('advance', 'repayment')),
  amount_centavos bigint not null check (amount_centavos > 0),
  source_type     text not null check (source_type in
                    ('cash_advance', 'purchase_deduction', 'direct_cash', 'adjustment', 'void')),
  source_id       uuid, -- e.g. purchases.id for purchase_deduction / void
  status          text not null default 'posted' check (status in ('pending', 'posted', 'rejected')),
  requires_approval boolean not null default false,
  approved_by     uuid references public.profiles (id),
  approved_at     timestamptz,
  remarks         text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index utang_ledger_farmer_idx on public.utang_ledger (business_id, farmer_id, status);

-- ----------------------------------------------------------------------------
-- Purchases — buying copra from farmers (Module 3)
--   Append-only. Corrections only via owner void (creates a reversal effect).
--   net_kg      = gross_kg - tare_kg - deduction_kg
--   gross_amount= round(net_kg * price_per_kg_centavos)
--   cash_paid   = gross_amount - utang_deducted
-- ----------------------------------------------------------------------------
create table public.purchases (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  receipt_no            bigint not null,
  farmer_id             uuid not null references public.farmers (id),
  grade_id              uuid references public.grades (id),
  purchased_at          timestamptz not null default now(),
  sack_count            integer not null default 0 check (sack_count >= 0),
  gross_kg              numeric(12,2) not null check (gross_kg >= 0),
  tare_kg               numeric(12,2) not null default 0 check (tare_kg >= 0),
  deduction_kg          numeric(12,2) not null default 0 check (deduction_kg >= 0),
  deduction_pct         numeric(5,2) not null default 0 check (deduction_pct >= 0),
  net_kg                numeric(12,2) not null check (net_kg >= 0),
  price_per_kg_centavos bigint not null check (price_per_kg_centavos >= 0),
  gross_amount_centavos bigint not null check (gross_amount_centavos >= 0),
  utang_deducted_centavos bigint not null default 0 check (utang_deducted_centavos >= 0),
  cash_paid_centavos    bigint not null check (cash_paid_centavos >= 0),
  remarks               text,
  scale_photo_url       text,
  client_uuid           uuid, -- offline idempotency key
  status                text not null default 'posted' check (status in ('posted', 'voided')),
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  voided_by             uuid references public.profiles (id),
  void_reason           text,
  voided_at             timestamptz,
  constraint purchases_receipt_unique unique (business_id, receipt_no),
  constraint purchases_client_uuid_unique unique (business_id, client_uuid),
  constraint purchases_utang_le_gross check (utang_deducted_centavos <= gross_amount_centavos)
);
create index purchases_business_date_idx on public.purchases (business_id, purchased_at desc);
create index purchases_farmer_idx on public.purchases (business_id, farmer_id);
