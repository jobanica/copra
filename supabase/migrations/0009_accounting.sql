-- ============================================================================
-- CopraBooks — Phase 3 schema: double-entry accounting + cash management.
--   Chart of accounts, accounting periods, journal entries/lines (balanced +
--   immutable), cash accounts, expenses, owner equity movements, and the
--   start/end-of-day cash cycle.
--
-- Every financial transaction auto-posts a balanced journal entry via triggers
-- (0010). Clients get SELECT only; all writes go through SECURITY DEFINER
-- functions. Posted entries are immutable — corrections are reversing entries.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Chart of accounts
-- ----------------------------------------------------------------------------
create table public.gl_accounts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  code           text not null,
  name           text not null,
  type           text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  is_cash        boolean not null default false,
  is_system      boolean not null default false,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (business_id, code)
);

-- ----------------------------------------------------------------------------
-- Accounting periods (month-end close locks a period)
-- ----------------------------------------------------------------------------
create table public.accounting_periods (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  year        integer not null,
  month       integer not null check (month between 1 and 12),
  status      text not null default 'open' check (status in ('open', 'closed')),
  closed_by   uuid references public.profiles (id),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (business_id, year, month)
);

-- ----------------------------------------------------------------------------
-- Journal entries + lines
-- ----------------------------------------------------------------------------
create table public.journal_entries (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  entry_no             bigint not null,
  entry_date           date not null,
  source_type          text not null,
  source_id            uuid,
  memo                 text,
  is_manual            boolean not null default false,
  status               text not null default 'posted' check (status in ('posted', 'reversed')),
  reverses_entry_id    uuid references public.journal_entries (id),
  reversed_by_entry_id uuid references public.journal_entries (id),
  period_id            uuid references public.accounting_periods (id),
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  unique (business_id, entry_no)
);
create index journal_entries_biz_date_idx on public.journal_entries (business_id, entry_date);
create index journal_entries_source_idx on public.journal_entries (business_id, source_type, source_id);

create table public.journal_lines (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.journal_entries (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  account_id      uuid not null references public.gl_accounts (id),
  debit_centavos  bigint not null default 0 check (debit_centavos >= 0),
  credit_centavos bigint not null default 0 check (credit_centavos >= 0),
  line_memo       text,
  -- Exactly one of debit/credit must be positive.
  constraint journal_line_one_side check ((debit_centavos = 0) <> (credit_centavos = 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);

-- Deferred balance check: every entry's debits must equal its credits at commit.
create or replace function public.assert_journal_balanced()
returns trigger
language plpgsql
as $$
declare
  v_debit  bigint;
  v_credit bigint;
begin
  -- The entry may have been deleted later in the same transaction (e.g. by
  -- rebuild_journal replacing a trigger-posted entry). Nothing to check then.
  perform 1 from public.journal_entries where id = new.id;
  if not found then return null; end if;

  select coalesce(sum(debit_centavos), 0), coalesce(sum(credit_centavos), 0)
    into v_debit, v_credit
    from public.journal_lines where entry_id = new.id;
  if v_debit <> v_credit then
    raise exception 'Journal entry % is not balanced (debit %, credit %)',
      new.entry_no, v_debit, v_credit;
  end if;
  if v_debit = 0 then
    raise exception 'Journal entry % has no lines', new.entry_no;
  end if;
  return new;
end;
$$;

create constraint trigger journal_entry_balanced
  after insert on public.journal_entries
  deferrable initially deferred
  for each row execute function public.assert_journal_balanced();

-- ----------------------------------------------------------------------------
-- Cash accounts (Cash on Hand, Bank, GCash — configurable)
-- ----------------------------------------------------------------------------
create table public.cash_accounts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('cash_on_hand', 'bank', 'gcash')),
  gl_account_id uuid not null references public.gl_accounts (id),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (business_id, name)
);

-- ----------------------------------------------------------------------------
-- Expenses (cashier may record, with receipt photo)
-- ----------------------------------------------------------------------------
create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  expense_date       date not null default (now() at time zone 'Asia/Manila')::date,
  expense_account_id uuid not null references public.gl_accounts (id),
  cash_account_id    uuid not null references public.cash_accounts (id),
  amount_centavos    bigint not null check (amount_centavos > 0),
  remarks            text,
  receipt_photo_url  text,
  status             text not null default 'posted' check (status in ('posted', 'voided')),
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  voided_by          uuid references public.profiles (id),
  void_reason        text,
  voided_at          timestamptz
);
create index expenses_biz_date_idx on public.expenses (business_id, expense_date desc);

-- ----------------------------------------------------------------------------
-- Owner equity movements: capital in, drawings, transfers between cash accounts
-- ----------------------------------------------------------------------------
create table public.equity_transactions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  txn_date        date not null default (now() at time zone 'Asia/Manila')::date,
  type            text not null check (type in ('capital_in', 'drawing', 'transfer')),
  amount_centavos bigint not null check (amount_centavos > 0),
  cash_account_id uuid references public.cash_accounts (id),  -- capital_in / drawing
  from_account_id uuid references public.cash_accounts (id),  -- transfer
  to_account_id   uuid references public.cash_accounts (id),  -- transfer
  remarks         text,
  status          text not null default 'posted' check (status in ('posted', 'voided')),
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index equity_biz_date_idx on public.equity_transactions (business_id, txn_date desc);

-- ----------------------------------------------------------------------------
-- Cash day cycle: opening float, end-of-day count, owner-approved close
-- ----------------------------------------------------------------------------
create table public.cash_days (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  business_date          date not null,
  opening_float_centavos bigint not null default 0,
  status                 text not null default 'open' check (status in ('open', 'counted', 'closed')),
  opened_by              uuid references public.profiles (id),
  closed_by              uuid references public.profiles (id),
  approved_by            uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  closed_at              timestamptz,
  unique (business_id, business_date)
);

create table public.cash_counts (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  cash_day_id       uuid not null references public.cash_days (id) on delete cascade,
  counted_centavos  bigint not null,
  expected_centavos bigint not null,
  variance_centavos bigint not null,
  denominations     jsonb,
  counted_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);
