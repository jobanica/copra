-- ============================================================================
-- CopraBooks — Phase 3 RLS, grants, default-account seeding, and journal
-- backfill. The ledger (journal, periods detail, equity) is owner-only;
-- cash accounts and expenses are visible to the whole business.
-- ============================================================================

alter table public.gl_accounts          enable row level security;
alter table public.accounting_periods   enable row level security;
alter table public.journal_entries      enable row level security;
alter table public.journal_lines        enable row level security;
alter table public.cash_accounts        enable row level security;
alter table public.expenses             enable row level security;
alter table public.equity_transactions  enable row level security;
alter table public.cash_days            enable row level security;
alter table public.cash_counts          enable row level security;

-- Chart of accounts: visible to the business; managed by the owner.
create policy gl_accounts_select on public.gl_accounts
  for select using (business_id = public.current_business_id());
create policy gl_accounts_write on public.gl_accounts
  for all using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- Periods: readable by the business; changed only via RPC.
create policy periods_select on public.accounting_periods
  for select using (business_id = public.current_business_id());

-- Ledger: owner-only.
create policy journal_entries_select on public.journal_entries
  for select using (business_id = public.current_business_id() and public.is_owner());
create policy journal_lines_select on public.journal_lines
  for select using (business_id = public.current_business_id() and public.is_owner());

-- Cash accounts: visible to the business; managed by the owner.
create policy cash_accounts_select on public.cash_accounts
  for select using (business_id = public.current_business_id());
create policy cash_accounts_write on public.cash_accounts
  for all using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- Expenses: visible to the business (cashier records them); writes via RPC.
create policy expenses_select on public.expenses
  for select using (business_id = public.current_business_id());

-- Equity movements: owner-only.
create policy equity_select on public.equity_transactions
  for select using (business_id = public.current_business_id() and public.is_owner());

-- Cash day cycle: visible to the business; writes via RPC.
create policy cash_days_select on public.cash_days
  for select using (business_id = public.current_business_id());
create policy cash_counts_select on public.cash_counts
  for select using (business_id = public.current_business_id());

-- Table grants (RLS still governs rows).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- RPC surface.
grant execute on function public.post_expense(uuid, uuid, bigint, date, text, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
grant execute on function public.record_equity(text, bigint, uuid, uuid, uuid, date, text) to authenticated;
grant execute on function public.create_manual_journal(date, text, jsonb) to authenticated;
grant execute on function public.close_period(int, int) to authenticated;
grant execute on function public.reopen_period(int, int) to authenticated;
grant execute on function public.open_cash_day(date, bigint) to authenticated;
grant execute on function public.record_cash_count(date, bigint, jsonb) to authenticated;
grant execute on function public.close_cash_day(date) to authenticated;

-- Internal helpers: not callable directly by clients.
revoke execute on function public._gl(uuid, text) from authenticated;
revoke execute on function public._cash_gl(uuid) from authenticated;
revoke execute on function public._insert_journal(uuid, date, text, uuid, text, boolean, uuid, jsonb, boolean) from authenticated;
revoke execute on function public._reverse_source_journal(uuid, text, uuid, text, uuid, boolean) from authenticated;
revoke execute on function public.rebuild_journal(uuid) from authenticated;
revoke execute on function public.seed_default_accounts(uuid) from authenticated;
revoke execute on function public.cash_expected_centavos(uuid, date, bigint) from authenticated;

-- ----------------------------------------------------------------------------
-- Backfill: seed default accounts and regenerate journals from Phase 1/2 data.
-- No-op on a fresh database (no businesses yet).
-- ----------------------------------------------------------------------------
select public.seed_default_accounts(id) from public.businesses;
select public.rebuild_journal(id) from public.businesses;
