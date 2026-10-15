-- ============================================================================
-- CopraBooks — Phase 2 functions: weighted-average inventory, truckload sales,
-- stock counts, and inventory-aware purchase posting/voiding.
--
-- Costing model (integer-centavos safe):
--   * Stock in (purchase): qty += net_kg, value += gross_amount.
--   * Stock out (sale): proportional cost = round(value * kg / qty); this keeps
--     the weighted-average cost per kg unchanged and avoids float drift.
--   * Shrinkage at a truckload: book_kg (records) - our_loaded_kg (actual) is
--     written off at avg cost. book_kg >= our_loaded_kg is required.
--   * Stock count: sets physical qty; value re-stated at current avg cost.
-- ============================================================================

-- Proportional cost of `p_kg` drawn from a pool of (p_value over p_qty).
create or replace function public._inv_cost_out(p_value bigint, p_qty numeric, p_kg numeric)
returns bigint
language sql
immutable
as $$
  select case
           when p_qty > 0 and p_kg > 0 then round(p_value::numeric * p_kg / p_qty)::bigint
           else 0
         end;
$$;

-- Apply one signed movement to inventory_state and append it to the log.
create or replace function public._inv_apply(
  p_business_id uuid,
  p_qty         numeric,   -- signed
  p_cost        bigint,    -- signed
  p_mtype       text,
  p_src_type    text,
  p_src_id      uuid,
  p_occurred    timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric(12,2);
  v_val bigint;
begin
  insert into public.inventory_state (business_id) values (p_business_id)
    on conflict (business_id) do nothing;

  select qty_on_hand_kg, total_value_centavos
    into v_qty, v_val
    from public.inventory_state
    where business_id = p_business_id
    for update;

  v_qty := round(v_qty + p_qty, 2);
  v_val := v_val + p_cost;

  update public.inventory_state
     set qty_on_hand_kg = v_qty,
         total_value_centavos = v_val,
         avg_cost_centavos = case when v_qty > 0 then round(v_val::numeric / v_qty, 4) else 0 end,
         updated_at = now()
   where business_id = p_business_id;

  insert into public.inventory_movements (
    business_id, movement_type, qty_kg, unit_cost_centavos, total_cost_centavos,
    source_type, source_id, balance_qty_after, balance_value_after, occurred_at)
  values (
    p_business_id, p_mtype, p_qty,
    case when p_qty <> 0 then round(p_cost::numeric / p_qty, 4) else null end,
    p_cost, p_src_type, p_src_id, v_qty, v_val, p_occurred);
end;
$$;

-- ----------------------------------------------------------------------------
-- rebuild_inventory — recompute state + movement log from scratch, replaying
-- posted purchases, sales and stock counts in chronological order. Used for
-- backfill (Phase 1 data), seeding, and repair. Also writes back the derived
-- columns on sales and stock_counts.
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
    order by ts, created_at
  loop
    if r.kind = 'purchase' then
      v_qty := round(v_qty + r.q, 2);
      v_val := v_val + r.c;
      perform public._inv_apply(p_business_id, r.q, r.c, 'purchase_in', 'purchase', r.id, r.ts);

    elsif r.kind = 'sale' then
      v_loaded := r.loaded;
      v_book := least(coalesce(nullif(r.book, 0), r.loaded), v_qty);      -- cannot draw more than on hand
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

-- ----------------------------------------------------------------------------
-- post_sale — record a truckload sale (owner only). Draws stock at weighted
-- average cost, computes shrinkage and cost of sales.
-- ----------------------------------------------------------------------------
create or replace function public.post_sale(
  p_buyer_id              uuid,
  p_sale_date             date,
  p_plate_no              text,
  p_driver                text,
  p_our_loaded_kg         numeric,
  p_our_avg_deduction_pct numeric,
  p_buyer_gross_kg        numeric,
  p_buyer_deduction_pct   numeric,
  p_buyer_net_kg          numeric,
  p_price_per_kg_centavos bigint,
  p_amount_received_centavos bigint,
  p_payment_method        text,
  p_trucking_centavos     bigint,
  p_labor_centavos        bigint,
  p_other_expenses_centavos bigint,
  p_book_kg               numeric,
  p_remarks               text
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_qty         numeric(12,2);
  v_val         bigint;
  v_book        numeric(12,2);
  v_loaded      numeric(12,2);
  v_cogs        bigint;
  v_shrink_val  bigint;
  v_shrink_kg   numeric(12,2);
  v_threshold   numeric(5,2);
  v_sale_no     bigint;
  v_row         public.sales;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can record sales';
  end if;
  if coalesce(p_our_loaded_kg, 0) <= 0 then
    raise exception 'Loaded kg must be greater than 0';
  end if;
  if p_buyer_id is not null then
    perform 1 from public.buyers where id = p_buyer_id and business_id = v_business_id;
    if not found then raise exception 'Buyer not found in this business'; end if;
  end if;

  v_loaded := round(p_our_loaded_kg, 2);
  v_book := round(coalesce(nullif(p_book_kg, 0), p_our_loaded_kg), 2);
  if v_book < v_loaded then
    raise exception 'Book kg (%) cannot be less than loaded kg (%)', v_book, v_loaded;
  end if;

  select qty_on_hand_kg, total_value_centavos into v_qty, v_val
    from public.inventory_state where business_id = v_business_id for update;
  v_qty := coalesce(v_qty, 0); v_val := coalesce(v_val, 0);
  if v_book > v_qty then
    raise exception 'Not enough stock: drawing % kg but only % kg on hand', v_book, v_qty;
  end if;

  select coalesce(shrinkage_threshold_pct, 3) into v_threshold
    from public.business_settings where business_id = v_business_id;
  v_threshold := coalesce(v_threshold, 3);

  v_cogs := public._inv_cost_out(v_val, v_qty, v_loaded);
  v_shrink_val := public._inv_cost_out(v_val, v_qty, v_book) - v_cogs;
  v_shrink_kg := round(v_book - v_loaded, 2);

  v_sale_no := public.allocate_document_number(v_business_id, 'sale');

  insert into public.sales (
    business_id, sale_no, buyer_id, sale_date, plate_no, driver,
    our_loaded_kg, our_avg_deduction_pct, buyer_gross_kg, buyer_deduction_pct, buyer_net_kg,
    price_per_kg_centavos, amount_received_centavos, payment_method,
    trucking_centavos, labor_centavos, other_expenses_centavos,
    book_kg, shrinkage_kg, shrinkage_value_centavos, cost_of_sales_centavos,
    shrinkage_flag, remarks, status, created_by)
  values (
    v_business_id, v_sale_no, p_buyer_id, coalesce(p_sale_date, (now() at time zone 'Asia/Manila')::date),
    p_plate_no, p_driver,
    v_loaded, coalesce(p_our_avg_deduction_pct, 0), p_buyer_gross_kg, p_buyer_deduction_pct, p_buyer_net_kg,
    coalesce(p_price_per_kg_centavos, 0), coalesce(p_amount_received_centavos, 0), p_payment_method,
    coalesce(p_trucking_centavos, 0), coalesce(p_labor_centavos, 0), coalesce(p_other_expenses_centavos, 0),
    v_book, v_shrink_kg, v_shrink_val, v_cogs,
    (v_book > 0 and (v_shrink_kg / v_book) * 100 > v_threshold),
    p_remarks, 'posted', v_actor)
  returning * into v_row;

  -- Apply to inventory (sale_out at COGS, plus any shrinkage write-off).
  perform public._inv_apply(v_business_id, -v_loaded, -v_cogs, 'sale_out', 'sale', v_row.id, v_row.sale_date::timestamptz);
  if v_shrink_kg > 0 then
    perform public._inv_apply(v_business_id, -v_shrink_kg, -v_shrink_val, 'shrinkage', 'sale', v_row.id, v_row.sale_date::timestamptz);
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- void_sale — owner-only reversal; returns the drawn stock to inventory.
-- ----------------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_row         public.sales;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can void sales';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A void reason is required';
  end if;

  select * into v_row from public.sales
    where id = p_sale_id and business_id = v_business_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_row.status = 'voided' then raise exception 'Sale is already voided'; end if;

  update public.sales
     set status = 'voided', voided_by = v_actor, void_reason = p_reason, voided_at = now()
   where id = p_sale_id
  returning * into v_row;

  -- Return the full book draw (COGS + shrinkage write-off) to inventory.
  perform public._inv_apply(
    v_business_id, v_row.book_kg, v_row.cost_of_sales_centavos + v_row.shrinkage_value_centavos,
    'sale_void', 'sale', v_row.id, now());

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, reason, before)
  values (v_business_id, v_actor, 'void', 'sale', v_row.id, p_reason, to_jsonb(v_row));

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- post_stock_count — owner-only physical count adjustment.
-- ----------------------------------------------------------------------------
create or replace function public.post_stock_count(
  p_counted_kg numeric,
  p_count_date date,
  p_remarks    text
)
returns public.stock_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_qty         numeric(12,2);
  v_val         bigint;
  v_new_val     bigint;
  v_row         public.stock_counts;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can record stock counts';
  end if;
  if coalesce(p_counted_kg, -1) < 0 then
    raise exception 'Counted kg must be 0 or more';
  end if;

  select qty_on_hand_kg, total_value_centavos into v_qty, v_val
    from public.inventory_state where business_id = v_business_id for update;
  v_qty := coalesce(v_qty, 0); v_val := coalesce(v_val, 0);
  v_new_val := case when v_qty > 0 then round(v_val::numeric * p_counted_kg / v_qty)::bigint else 0 end;

  insert into public.stock_counts (
    business_id, count_date, counted_kg, book_kg, variance_kg,
    adjustment_value_centavos, remarks, status, created_by)
  values (
    v_business_id, coalesce(p_count_date, (now() at time zone 'Asia/Manila')::date),
    round(p_counted_kg, 2), v_qty, round(p_counted_kg - v_qty, 2),
    v_new_val - v_val, p_remarks, 'posted', v_actor)
  returning * into v_row;

  perform public._inv_apply(v_business_id, round(p_counted_kg - v_qty, 2), v_new_val - v_val,
                            'count_adj', 'stock_count', v_row.id, v_row.count_date::timestamptz);

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, after)
  values (v_business_id, v_actor, 'stock_count', 'stock_count', v_row.id, to_jsonb(v_row));

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Retrofit purchase posting/voiding to keep inventory in step.
-- (Replaces the Phase 1 definitions; identical logic plus inventory apply.)
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
  p_client_uuid           uuid
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_net_kg      numeric(12,2);
  v_price       bigint;
  v_gross_amt   bigint;
  v_cash_paid   bigint;
  v_balance     bigint;
  v_receipt_no  bigint;
  v_existing    public.purchases;
  v_row         public.purchases;
begin
  if v_business_id is null then
    raise exception 'No business context for current user';
  end if;

  if p_client_uuid is not null then
    select * into v_existing from public.purchases
      where business_id = v_business_id and client_uuid = p_client_uuid;
    if found then return v_existing; end if;
  end if;

  perform 1 from public.farmers where id = p_farmer_id and business_id = v_business_id;
  if not found then raise exception 'Farmer not found in this business'; end if;

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

  v_net_kg := round(coalesce(p_gross_kg,0) - coalesce(p_tare_kg,0) - coalesce(p_deduction_kg,0), 2);
  if v_net_kg < 0 then
    raise exception 'Net kg cannot be negative (gross % tare % deduction %)',
      p_gross_kg, p_tare_kg, p_deduction_kg;
  end if;

  v_gross_amt := round(v_net_kg * v_price)::bigint;

  v_balance := public.farmer_balance_centavos(p_farmer_id);
  if coalesce(p_utang_deducted_centavos,0) > v_gross_amt then
    raise exception 'Utang deducted (%) exceeds gross amount (%)', p_utang_deducted_centavos, v_gross_amt;
  end if;
  if coalesce(p_utang_deducted_centavos,0) > v_balance then
    raise exception 'Utang deducted (%) exceeds farmer balance (%)', p_utang_deducted_centavos, v_balance;
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
    coalesce(p_sack_count,0), coalesce(p_gross_kg,0), coalesce(p_tare_kg,0),
    coalesce(p_deduction_kg,0), coalesce(p_deduction_pct,0), v_net_kg,
    v_price, v_gross_amt, coalesce(p_utang_deducted_centavos,0),
    v_cash_paid, p_remarks, p_scale_photo_url, p_client_uuid, 'posted', v_actor
  ) returning * into v_row;

  if coalesce(p_utang_deducted_centavos,0) > 0 then
    insert into public.utang_ledger (
      business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, created_by
    ) values (
      v_business_id, p_farmer_id, (v_row.purchased_at at time zone 'Asia/Manila')::date,
      'repayment', p_utang_deducted_centavos, 'purchase_deduction', v_row.id, 'posted', v_actor);
  end if;

  -- Stock in at cost (net kg valued at the amount paid for the copra).
  perform public._inv_apply(v_business_id, v_net_kg, v_gross_amt, 'purchase_in', 'purchase',
                            v_row.id, v_row.purchased_at);

  return v_row;
end;
$$;

create or replace function public.void_purchase(p_purchase_id uuid, p_reason text)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_row         public.purchases;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can void purchases';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A void reason is required';
  end if;

  select * into v_row from public.purchases
    where id = p_purchase_id and business_id = v_business_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_row.status = 'voided' then raise exception 'Purchase is already voided'; end if;

  update public.purchases
     set status = 'voided', voided_by = v_actor, void_reason = p_reason, voided_at = now()
   where id = p_purchase_id
  returning * into v_row;

  if v_row.utang_deducted_centavos > 0 then
    insert into public.utang_ledger (
      business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, remarks, created_by)
    values (
      v_business_id, v_row.farmer_id, (now() at time zone 'Asia/Manila')::date,
      'advance', v_row.utang_deducted_centavos, 'void', v_row.id, 'posted',
      'Reversal of voided receipt #' || v_row.receipt_no, v_actor);
  end if;

  -- Remove the stock this purchase added.
  perform public._inv_apply(v_business_id, -v_row.net_kg, -v_row.gross_amount_centavos,
                            'purchase_void', 'purchase', v_row.id, now());

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, reason, before)
  values (v_business_id, v_actor, 'void', 'purchase', v_row.id, p_reason, to_jsonb(v_row));

  return v_row;
end;
$$;
