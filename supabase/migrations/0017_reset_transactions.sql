-- ----------------------------------------------------------------------------
-- CopraBooks — owner-only "clear all transactions" reset.
--
-- Wipes every transactional record for the current business while KEEPING
-- master/config data (business, users, settings, grades, chart of accounts,
-- cash accounts, farmers, buyers and prices). Receipt/sale/journal numbering
-- restarts at 1 and running inventory is zeroed.
--
-- All journal/inventory posting triggers fire on INSERT/UPDATE only, so these
-- deletes do not re-post or recompute anything. Child tables cascade from
-- their parents (journal_lines, cash_counts, purchase_weighings).
-- ----------------------------------------------------------------------------
create or replace function public.reset_business_transactions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null then
    raise exception 'No business context for current user';
  end if;
  if not public.is_owner() then
    raise exception 'Only the owner can clear transactions';
  end if;

  delete from public.journal_entries   where business_id = v_biz; -- cascades journal_lines
  delete from public.cash_days         where business_id = v_biz; -- cascades cash_counts
  delete from public.purchases         where business_id = v_biz; -- cascades purchase_weighings
  delete from public.sales             where business_id = v_biz;
  delete from public.inventory_movements where business_id = v_biz;
  delete from public.stock_counts      where business_id = v_biz;
  delete from public.expenses          where business_id = v_biz;
  delete from public.equity_transactions where business_id = v_biz;
  delete from public.utang_ledger      where business_id = v_biz;
  delete from public.accounting_periods where business_id = v_biz;
  delete from public.audit_log         where business_id = v_biz;

  -- Restart document numbering (receipts, sales, journal entries) at 1.
  delete from public.document_counters where business_id = v_biz;

  -- Zero the running inventory state (keep the single row).
  update public.inventory_state
     set qty_on_hand_kg = 0,
         total_value_centavos = 0,
         avg_cost_centavos = 0,
         updated_at = now()
   where business_id = v_biz;
end;
$$;

grant execute on function public.reset_business_transactions() to authenticated;
