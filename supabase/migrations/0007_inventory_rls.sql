-- ============================================================================
-- CopraBooks — Phase 2 RLS, grants, and inventory backfill.
--   Inventory stock position is visible to the whole business; sales,
--   stock counts and the movement log (which expose cost/profit detail) are
--   owner-only. Writes to all financial tables go through SECURITY DEFINER
--   functions; clients get SELECT only.
-- ============================================================================

alter table public.inventory_state      enable row level security;
alter table public.inventory_movements  enable row level security;
alter table public.buyers                enable row level security;
alter table public.sales                 enable row level security;
alter table public.stock_counts          enable row level security;

-- inventory_state: stock on hand is operational info for both roles.
create policy inv_state_select on public.inventory_state
  for select using (business_id = public.current_business_id());

-- inventory_movements: cost detail -> owner only.
create policy inv_moves_select on public.inventory_movements
  for select using (business_id = public.current_business_id() and public.is_owner());

-- buyers: readable by the business; managed by the owner.
create policy buyers_select on public.buyers
  for select using (business_id = public.current_business_id());
create policy buyers_write on public.buyers
  for all using (business_id = public.current_business_id() and public.is_owner())
  with check (business_id = public.current_business_id() and public.is_owner());

-- sales & stock_counts: owner-only visibility; writes via RPC.
create policy sales_select on public.sales
  for select using (business_id = public.current_business_id() and public.is_owner());
create policy stock_counts_select on public.stock_counts
  for select using (business_id = public.current_business_id() and public.is_owner());

-- Table grants for the new Phase 2 tables (RLS still governs rows).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- RPC surface.
grant execute on function public.post_sale(uuid, date, text, text, numeric, numeric, numeric, numeric, numeric, bigint, bigint, text, bigint, bigint, bigint, numeric, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.post_stock_count(numeric, date, text) to authenticated;

-- Internal helpers: not callable directly by clients.
revoke execute on function public.rebuild_inventory(uuid) from authenticated;
revoke execute on function public._inv_apply(uuid, numeric, bigint, text, text, uuid, timestamptz) from authenticated;
revoke execute on function public._inv_cost_out(bigint, numeric, numeric) from authenticated;

-- ----------------------------------------------------------------------------
-- Backfill: build inventory from existing posted purchases (Phase 1 data).
-- No-op on a fresh database.
-- ----------------------------------------------------------------------------
select public.rebuild_inventory(id) from public.businesses;
