-- ----------------------------------------------------------------------------
-- CopraBooks — restore automatic inventory stock-in on purchases.
--
-- Regression fix: migration 0016 rebuilt post_purchase (to add the weighings
-- breakdown) from the Phase 1 definition, which did NOT post to inventory.
-- The Phase 2 definition (0006) ended with an _inv_apply('purchase_in') call
-- that stocks the net kg in at cost. This restores that call, so every
-- purchase again increases stock on hand AND value at cost automatically.
--
-- It also makes the per-record deletes resync inventory by replaying from
-- scratch (rebuild_inventory), since deleting a purchase/sale changes stock.
-- ----------------------------------------------------------------------------

create or replace function public.post_purchase(
  p_farmer_id             uuid,
  p_grade_id              uuid,
  p_purchased_at          timestamptz,
  p_sack_count            integer,
  p_gross_kg              numeric,
  p_tare_kg               numeric,
  p_deduction_kg          numeric,
  p_deduction_pct         numeric,
  p_price_per_kg_centavos bigint,
  p_utang_deducted_centavos bigint,
  p_remarks               text,
  p_scale_photo_url       text,
  p_client_uuid           uuid,
  p_weighings             jsonb default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_sack_count  integer;
  v_gross_kg    numeric(12,2);
  v_net_kg      numeric(12,2);
  v_price       bigint;
  v_gross_amt   bigint;
  v_cash_paid   bigint;
  v_balance     bigint;
  v_receipt_no  bigint;
  v_has_weighings boolean := p_weighings is not null and jsonb_array_length(p_weighings) > 0;
  v_existing    public.purchases;
  v_row         public.purchases;
begin
  if v_business_id is null then
    raise exception 'No business context for current user';
  end if;

  if p_client_uuid is not null then
    select * into v_existing from public.purchases
      where business_id = v_business_id and client_uuid = p_client_uuid;
    if found then
      return v_existing;
    end if;
  end if;

  perform 1 from public.farmers
    where id = p_farmer_id and business_id = v_business_id;
  if not found then
    raise exception 'Farmer not found in this business';
  end if;

  select price_per_kg_centavos into v_price
    from public.buying_prices
    where business_id = v_business_id
      and effective_date = (p_purchased_at at time zone 'Asia/Manila')::date
      and grade_id is not distinct from p_grade_id;
  if not found then
    select price_per_kg_centavos into v_price
      from public.buying_prices
      where business_id = v_business_id
        and effective_date = (p_purchased_at at time zone 'Asia/Manila')::date
        and grade_id is null;
  end if;
  if v_price is null then
    raise exception 'Buying price is not set for this date/grade';
  end if;
  if p_price_per_kg_centavos is not null and p_price_per_kg_centavos <> v_price then
    raise exception 'Price has changed since this was recorded (was %, now %)',
      p_price_per_kg_centavos, v_price;
  end if;

  if v_has_weighings then
    select coalesce(sum(coalesce((elem->>'sacks')::integer, 0)), 0),
           coalesce(sum(coalesce((elem->>'kg')::numeric, 0)), 0)
      into v_sack_count, v_gross_kg
      from jsonb_array_elements(p_weighings) as elem;
  else
    v_sack_count := coalesce(p_sack_count, 0);
    v_gross_kg   := coalesce(p_gross_kg, 0);
  end if;

  v_net_kg := round(v_gross_kg - coalesce(p_tare_kg,0) - coalesce(p_deduction_kg,0), 2);
  if v_net_kg < 0 then
    raise exception 'Net kg cannot be negative (gross % tare % deduction %)',
      v_gross_kg, p_tare_kg, p_deduction_kg;
  end if;

  v_gross_amt := round(v_net_kg * v_price)::bigint;

  v_balance := public.farmer_balance_centavos(p_farmer_id);
  if coalesce(p_utang_deducted_centavos,0) > v_gross_amt then
    raise exception 'Utang deducted (%) exceeds gross amount (%)',
      p_utang_deducted_centavos, v_gross_amt;
  end if;
  if coalesce(p_utang_deducted_centavos,0) > v_balance then
    raise exception 'Utang deducted (%) exceeds farmer balance (%)',
      p_utang_deducted_centavos, v_balance;
  end if;

  v_cash_paid := v_gross_amt - coalesce(p_utang_deducted_centavos,0);
  v_receipt_no := public.allocate_document_number(v_business_id, 'purchase_receipt');

  insert into public.purchases (
    business_id, receipt_no, farmer_id, grade_id, purchased_at, sack_count,
    gross_kg, tare_kg, deduction_kg, deduction_pct, net_kg,
    price_per_kg_centavos, gross_amount_centavos, utang_deducted_centavos,
    cash_paid_centavos, remarks, scale_photo_url, client_uuid, status, created_by
  ) values (
    v_business_id, v_receipt_no, p_farmer_id, p_grade_id, coalesce(p_purchased_at, now()),
    v_sack_count, v_gross_kg, coalesce(p_tare_kg,0),
    coalesce(p_deduction_kg,0), coalesce(p_deduction_pct,0), v_net_kg,
    v_price, v_gross_amt, coalesce(p_utang_deducted_centavos,0),
    v_cash_paid, p_remarks, p_scale_photo_url, p_client_uuid, 'posted', v_actor
  ) returning * into v_row;

  if v_has_weighings then
    insert into public.purchase_weighings (
      business_id, purchase_id, seq, sack_count, weight_kg
    )
    select v_business_id, v_row.id, (ord)::integer,
           coalesce((elem->>'sacks')::integer, 0),
           coalesce((elem->>'kg')::numeric, 0)
      from jsonb_array_elements(p_weighings) with ordinality as t(elem, ord);
  end if;

  if coalesce(p_utang_deducted_centavos,0) > 0 then
    insert into public.utang_ledger (
      business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, created_by
    ) values (
      v_business_id, p_farmer_id,
      (v_row.purchased_at at time zone 'Asia/Manila')::date,
      'repayment', p_utang_deducted_centavos, 'purchase_deduction', v_row.id,
      'posted', v_actor
    );
  end if;

  -- Stock in at cost (net kg valued at the amount paid for the copra).
  perform public._inv_apply(v_business_id, v_net_kg, v_gross_amt, 'purchase_in',
                            'purchase', v_row.id, v_row.purchased_at);

  return v_row;
end;
$$;

grant execute on function public.post_purchase(
  uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric,
  bigint, bigint, text, text, uuid, jsonb
) to authenticated;

-- Deletes that change stock now resync inventory from scratch.
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
  delete from public.purchases         where business_id = v_biz and id = p_purchase_id;
  perform public.rebuild_inventory(v_biz);
end;
$$;

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

  delete from public.journal_entries where business_id = v_biz and source_id = p_sale_id;
  delete from public.sales           where business_id = v_biz and id = p_sale_id;
  perform public.rebuild_inventory(v_biz);
end;
$$;

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

  delete from public.journal_entries
    where business_id = v_biz and source_type = 'utang'
      and source_id in (select id from public.utang_ledger
                          where business_id = v_biz and farmer_id = p_farmer_id);
  delete from public.journal_entries
    where business_id = v_biz
      and source_id in (select id from public.purchases
                          where business_id = v_biz and farmer_id = p_farmer_id);
  delete from public.utang_ledger where business_id = v_biz and farmer_id = p_farmer_id;
  delete from public.purchases    where business_id = v_biz and farmer_id = p_farmer_id;
  delete from public.farmers      where business_id = v_biz and id = p_farmer_id;
  perform public.rebuild_inventory(v_biz);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fix rebuild_inventory ordering. It previously ordered by business date
-- (sale_date / purchased_at), so a same-day sale (date at midnight) replayed
-- before same-day purchases (actual timestamps), corrupting the running
-- weighted average. Replay in true record-creation order (created_at) so the
-- rebuild matches how post_purchase / post_sale posted incrementally.
-- ----------------------------------------------------------------------------
create or replace function public.rebuild_inventory(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold numeric(5,2);
  v_qty  numeric(12,2) := 0;
  v_val  bigint := 0;
  v_cogs bigint;
  v_shrink_val bigint;
  v_shrink_kg numeric(12,2);
  v_book numeric(12,2);
  v_loaded numeric(12,2);
  v_counted numeric(12,2);
  v_new_val bigint;
  r record;
begin
  select coalesce(shrinkage_threshold_pct, 3) into v_threshold
    from public.business_settings where business_id = p_business_id;
  v_threshold := coalesce(v_threshold, 3);

  delete from public.inventory_movements where business_id = p_business_id;
  insert into public.inventory_state (business_id, qty_on_hand_kg, total_value_centavos, avg_cost_centavos)
    values (p_business_id, 0, 0, 0)
    on conflict (business_id) do update
      set qty_on_hand_kg = 0, total_value_centavos = 0, avg_cost_centavos = 0, updated_at = now();

  for r in
    select 'purchase' as kind, purchased_at as ts, created_at,
           id, net_kg as q, gross_amount_centavos as c, 0::numeric as loaded, null::numeric as book, null::numeric as counted
      from public.purchases
      where business_id = p_business_id and status = 'posted'
    union all
    select 'sale', sale_date::timestamptz, created_at,
           id, 0, 0, our_loaded_kg, greatest(book_kg, our_loaded_kg), null
      from public.sales
      where business_id = p_business_id and status = 'posted'
    union all
    select 'count', count_date::timestamptz, created_at,
           id, 0, 0, 0, null, counted_kg
      from public.stock_counts
      where business_id = p_business_id and status = 'posted'
    order by created_at, ts
  loop
    if r.kind = 'purchase' then
      v_qty := round(v_qty + r.q, 2);
      v_val := v_val + r.c;
      perform public._inv_apply(p_business_id, r.q, r.c, 'purchase_in', 'purchase', r.id, r.ts);

    elsif r.kind = 'sale' then
      v_loaded := r.loaded;
      v_book := least(coalesce(nullif(r.book, 0), r.loaded), v_qty);
      if v_book < v_loaded then v_book := v_loaded; end if;
      v_cogs := public._inv_cost_out(v_val, v_qty, v_loaded);
      v_shrink_val := public._inv_cost_out(v_val, v_qty, v_book) - v_cogs;
      v_shrink_kg := round(v_book - v_loaded, 2);
      v_qty := round(v_qty - v_book, 2);
      v_val := v_val - (v_cogs + v_shrink_val);

      update public.sales
         set book_kg = v_book,
             shrinkage_kg = v_shrink_kg,
             shrinkage_value_centavos = v_shrink_val,
             cost_of_sales_centavos = v_cogs,
             shrinkage_flag = (v_book > 0 and (v_shrink_kg / v_book) * 100 > v_threshold)
       where id = r.id;

      perform public._inv_apply(p_business_id, -v_loaded, -v_cogs, 'sale_out', 'sale', r.id, r.ts);
      if v_shrink_kg > 0 then
        perform public._inv_apply(p_business_id, -v_shrink_kg, -v_shrink_val, 'shrinkage', 'sale', r.id, r.ts);
      end if;

    elsif r.kind = 'count' then
      v_counted := r.counted;
      v_new_val := case when v_qty > 0 then round(v_val::numeric * v_counted / v_qty)::bigint else 0 end;
      update public.stock_counts
         set book_kg = v_qty,
             variance_kg = round(v_counted - v_qty, 2),
             adjustment_value_centavos = v_new_val - v_val
       where id = r.id;
      perform public._inv_apply(p_business_id, round(v_counted - v_qty, 2), v_new_val - v_val,
                                'count_adj', 'stock_count', r.id, r.ts);
      v_qty := v_counted;
      v_val := v_new_val;
    end if;
  end loop;
end;
$$;
