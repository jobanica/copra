-- ----------------------------------------------------------------------------
-- CopraBooks — owner-only per-record hard delete.
--
-- Replaces the bulk "clear all transactions" reset with granular deletes, so
-- the owner can remove individual test records (and their derived journal /
-- inventory / utang rows) one at a time, or delete a whole test farmer.
--
-- Posting triggers fire on INSERT/UPDATE only, so these deletes never re-post.
-- Journals for a purchase/sale/expense are keyed by source_id = the record id;
-- the utang repayment a purchase created is keyed by source_id = the ledger id.
-- ----------------------------------------------------------------------------

drop function if exists public.reset_business_transactions();

-- Purchase: drop its utang repayment + that repayment's journal, its own
-- journals (posted/void) and inventory movements, then the purchase (its
-- weighings cascade).
create or replace function public.delete_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can delete purchases'; end if;

  delete from public.journal_entries
    where business_id = v_biz and source_type = 'utang'
      and source_id in (select id from public.utang_ledger
                          where business_id = v_biz and source_id = p_purchase_id);
  delete from public.utang_ledger      where business_id = v_biz and source_id = p_purchase_id;
  delete from public.journal_entries   where business_id = v_biz and source_id = p_purchase_id;
  delete from public.inventory_movements where business_id = v_biz and source_id = p_purchase_id;
  delete from public.purchases         where business_id = v_biz and id = p_purchase_id;
end;
$$;

-- Sale: drop its journals (posted/void) and inventory movements, then the sale.
create or replace function public.delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can delete sales'; end if;

  delete from public.journal_entries     where business_id = v_biz and source_id = p_sale_id;
  delete from public.inventory_movements where business_id = v_biz and source_id = p_sale_id;
  delete from public.sales               where business_id = v_biz and id = p_sale_id;
end;
$$;

-- Expense: drop its journals (posted/void), then the expense.
create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can delete expenses'; end if;

  delete from public.journal_entries where business_id = v_biz and source_id = p_expense_id;
  delete from public.expenses        where business_id = v_biz and id = p_expense_id;
end;
$$;

-- A single utang ledger entry (advance / repayment) and its journal.
create or replace function public.delete_utang_entry(p_ledger_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can delete utang entries'; end if;

  delete from public.journal_entries
    where business_id = v_biz and source_type = 'utang' and source_id = p_ledger_id;
  delete from public.utang_ledger where business_id = v_biz and id = p_ledger_id;
end;
$$;

-- A farmer and ALL of their own transactions (purchases + utang and the
-- journal / inventory rows those produced). Master prices/accounts are kept.
create or replace function public.delete_farmer(p_farmer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can delete farmers'; end if;

  -- Journals for this farmer's utang entries, and for their purchases.
  delete from public.journal_entries
    where business_id = v_biz and source_type = 'utang'
      and source_id in (select id from public.utang_ledger
                          where business_id = v_biz and farmer_id = p_farmer_id);
  delete from public.journal_entries
    where business_id = v_biz
      and source_id in (select id from public.purchases
                          where business_id = v_biz and farmer_id = p_farmer_id);
  delete from public.inventory_movements
    where business_id = v_biz
      and source_id in (select id from public.purchases
                          where business_id = v_biz and farmer_id = p_farmer_id);
  delete from public.utang_ledger where business_id = v_biz and farmer_id = p_farmer_id;
  delete from public.purchases    where business_id = v_biz and farmer_id = p_farmer_id;
  delete from public.farmers      where business_id = v_biz and id = p_farmer_id;
end;
$$;

grant execute on function public.delete_purchase(uuid)     to authenticated;
grant execute on function public.delete_sale(uuid)         to authenticated;
grant execute on function public.delete_expense(uuid)      to authenticated;
grant execute on function public.delete_utang_entry(uuid)  to authenticated;
grant execute on function public.delete_farmer(uuid)       to authenticated;
