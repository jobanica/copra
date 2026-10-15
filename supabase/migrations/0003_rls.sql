-- ============================================================================
-- CopraBooks — Phase 1 Row Level Security
--   Tenant isolation on every table via current_business_id(). Financial
--   append-only tables (utang_ledger, purchases) expose SELECT only; all
--   writes flow through the SECURITY DEFINER functions in 0002_functions.sql.
-- ============================================================================

alter table public.businesses            enable row level security;
alter table public.profiles              enable row level security;
alter table public.business_settings     enable row level security;
alter table public.document_counters     enable row level security;
alter table public.audit_log             enable row level security;
alter table public.grades                enable row level security;
alter table public.buying_prices         enable row level security;
alter table public.buyer_reference_prices enable row level security;
alter table public.farmers               enable row level security;
alter table public.utang_ledger          enable row level security;
alter table public.purchases             enable row level security;

-- businesses -----------------------------------------------------------------
create policy businesses_select on public.businesses
  for select using (id = public.current_business_id());
create policy businesses_update on public.businesses
  for update using (id = public.current_business_id() and public.is_owner())
  with check (id = public.current_business_id() and public.is_owner());

-- profiles -------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select using (business_id = public.current_business_id());
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and business_id = public.current_business_id());
create policy profiles_update_owner on public.profiles
  for update using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id());

-- business_settings ----------------------------------------------------------
create policy settings_select on public.business_settings
  for select using (business_id = public.current_business_id());
create policy settings_update on public.business_settings
  for update using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- document_counters: no client policies -> managed only via definer functions.

-- audit_log: owner may read; writes only via definer functions.
create policy audit_select on public.audit_log
  for select using (business_id = public.current_business_id() and public.is_owner());

-- grades ---------------------------------------------------------------------
create policy grades_select on public.grades
  for select using (business_id = public.current_business_id());
create policy grades_write on public.grades
  for all using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- buying_prices (owner sets; everyone in the business reads) ------------------
create policy prices_select on public.buying_prices
  for select using (business_id = public.current_business_id());
create policy prices_insert on public.buying_prices
  for insert with check (business_id = public.current_business_id() and public.is_owner());
create policy prices_update on public.buying_prices
  for update using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

create policy buyer_prices_select on public.buyer_reference_prices
  for select using (business_id = public.current_business_id());
create policy buyer_prices_insert on public.buyer_reference_prices
  for insert with check (business_id = public.current_business_id() and public.is_owner());
create policy buyer_prices_update on public.buyer_reference_prices
  for update using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- farmers (owner or cashier may add / edit) ----------------------------------
create policy farmers_select on public.farmers
  for select using (business_id = public.current_business_id());
create policy farmers_insert on public.farmers
  for insert with check (business_id = public.current_business_id());
create policy farmers_update on public.farmers
  for update using (business_id = public.current_business_id())
  with check (business_id = public.current_business_id());

-- utang_ledger: read only for clients; writes via definer functions.
create policy utang_select on public.utang_ledger
  for select using (business_id = public.current_business_id());

-- purchases: read only for clients; writes via definer functions.
create policy purchases_select on public.purchases
  for select using (business_id = public.current_business_id());

-- ----------------------------------------------------------------------------
-- Table grants. Supabase normally applies these to new public tables via
-- default privileges; we state them explicitly so the schema is portable.
-- Row access is still fully governed by the RLS policies above — e.g. the
-- append-only tables (purchases, utang_ledger) have only SELECT policies, so
-- INSERT/UPDATE/DELETE are denied regardless of this grant.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ----------------------------------------------------------------------------
-- Grants: expose the RPC surface to authenticated users.
-- ----------------------------------------------------------------------------
grant execute on function public.current_business_id()                 to authenticated;
grant execute on function public.current_user_role()                   to authenticated;
grant execute on function public.is_owner()                            to authenticated;
grant execute on function public.farmer_balance_centavos(uuid)         to authenticated;
grant execute on function public.post_purchase(uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric, bigint, bigint, text, text, uuid) to authenticated;
grant execute on function public.void_purchase(uuid, text)             to authenticated;
grant execute on function public.create_advance(uuid, bigint, text)    to authenticated;
grant execute on function public.approve_advance(uuid)                 to authenticated;
grant execute on function public.reject_advance(uuid, text)            to authenticated;
grant execute on function public.record_cash_repayment(uuid, bigint, text) to authenticated;

-- allocate_document_number is internal; do not expose directly.
revoke execute on function public.allocate_document_number(uuid, text) from authenticated;
