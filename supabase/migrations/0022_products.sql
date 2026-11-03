-- ----------------------------------------------------------------------------
-- CopraBooks — second product line: Charcoal (Uling), alongside Copra.
--
-- Charcoal behaves exactly like copra (bought/sold by kg, weighted-average
-- cost), on the same screens, sharing cash, farmers and books. Stock and
-- value are tracked separately per product. This adds a `product` dimension
-- ('copra' default | 'charcoal') to the transactional + inventory tables and
-- threads it through the inventory engine and the dashboard view.
-- ----------------------------------------------------------------------------

alter table public.purchases          add column if not exists product text not null default 'copra';
alter table public.sales              add column if not exists product text not null default 'copra';
alter table public.inventory_movements add column if not exists product text not null default 'copra';
alter table public.stock_counts       add column if not exists product text not null default 'copra';
alter table public.buying_prices      add column if not exists product text not null default 'copra';

alter table public.purchases          add constraint purchases_product_chk   check (product in ('copra','charcoal'));
alter table public.sales              add constraint sales_product_chk       check (product in ('copra','charcoal'));
alter table public.inventory_movements add constraint inv_moves_product_chk  check (product in ('copra','charcoal'));
alter table public.stock_counts       add constraint stock_counts_product_chk check (product in ('copra','charcoal'));
alter table public.buying_prices      add constraint buying_prices_product_chk check (product in ('copra','charcoal'));

-- The one-price-per-day-per-grade uniqueness is now per product too.
drop index if exists public.buying_prices_date_grade_idx;
create unique index buying_prices_date_grade_idx
  on public.buying_prices (business_id, effective_date, product, coalesce(grade_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- inventory_state is now one running balance per (business, product).
alter table public.inventory_state add column if not exists product text not null default 'copra';
alter table public.inventory_state add constraint inventory_state_product_chk check (product in ('copra','charcoal'));
alter table public.inventory_state drop constraint inventory_state_pkey;
alter table public.inventory_state add constraint inventory_state_pkey primary key (business_id, product);

-- ----------------------------------------------------------------------------
-- _inv_apply — now keyed by product (added as a trailing argument, default
-- 'copra' so any un-migrated caller still targets copra).
-- ----------------------------------------------------------------------------
drop function if exists public._inv_apply(uuid, numeric, bigint, text, text, uuid, timestamptz);
create or replace function public._inv_apply(
  p_business_id uuid,
  p_qty         numeric,
  p_cost        bigint,
  p_mtype       text,
  p_src_type    text,
  p_src_id      uuid,
  p_occurred    timestamptz,
  p_product     text default 'copra'
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_qty numeric(12,2); v_val bigint;
begin
  insert into public.inventory_state (business_id, product) values (p_business_id, p_product)
    on conflict (business_id, product) do nothing;

  select qty_on_hand_kg, total_value_centavos into v_qty, v_val
    from public.inventory_state
    where business_id = p_business_id and product = p_product
    for update;

  v_qty := round(v_qty + p_qty, 2);
  v_val := v_val + p_cost;

  update public.inventory_state
     set qty_on_hand_kg = v_qty,
         total_value_centavos = v_val,
         avg_cost_centavos = case when v_qty > 0 then round(v_val::numeric / v_qty, 4) else 0 end,
         updated_at = now()
   where business_id = p_business_id and product = p_product;

  insert into public.inventory_movements (
    business_id, product, movement_type, qty_kg, unit_cost_centavos, total_cost_centavos,
    source_type, source_id, balance_qty_after, balance_value_after, occurred_at)
  values (
    p_business_id, p_product, p_mtype, p_qty,
    case when p_qty <> 0 then round(p_cost::numeric / p_qty, 4) else null end,
    p_cost, p_src_type, p_src_id, v_qty, v_val, p_occurred);
end;
$$;

-- ----------------------------------------------------------------------------
-- rebuild_inventory — recompute each product's running balance from scratch.
-- ----------------------------------------------------------------------------
create or replace function public.rebuild_inventory(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_threshold numeric(5,2);
  v_product   text;
  v_qty  numeric(12,2);
  v_val  bigint;
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

  foreach v_product in array array['copra','charcoal'] loop
    insert into public.inventory_state (business_id, product, qty_on_hand_kg, total_value_centavos, avg_cost_centavos)
      values (p_business_id, v_product, 0, 0, 0)
      on conflict (business_id, product) do update
        set qty_on_hand_kg = 0, total_value_centavos = 0, avg_cost_centavos = 0, updated_at = now();

    v_qty := 0; v_val := 0;
    for r in
      select 'purchase' as kind, purchased_at as ts, created_at,
             id, net_kg as q, gross_amount_centavos as c, 0::numeric as loaded, null::numeric as book, null::numeric as counted
        from public.purchases
        where business_id = p_business_id and status = 'posted' and product = v_product
      union all
      select 'sale', sale_date::timestamptz, created_at,
             id, 0, 0, our_loaded_kg, greatest(book_kg, our_loaded_kg), null
        from public.sales
        where business_id = p_business_id and status = 'posted' and product = v_product
      union all
      select 'count', count_date::timestamptz, created_at,
             id, 0, 0, 0, null, counted_kg
        from public.stock_counts
        where business_id = p_business_id and status = 'posted' and product = v_product
      order by created_at, ts
    loop
      if r.kind = 'purchase' then
        v_qty := round(v_qty + r.q, 2);
        v_val := v_val + r.c;
        perform public._inv_apply(p_business_id, r.q, r.c, 'purchase_in', 'purchase', r.id, r.ts, v_product);

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
           set book_kg = v_book, shrinkage_kg = v_shrink_kg,
               shrinkage_value_centavos = v_shrink_val, cost_of_sales_centavos = v_cogs,
               shrinkage_flag = (v_book > 0 and (v_shrink_kg / v_book) * 100 > v_threshold)
         where id = r.id;

        perform public._inv_apply(p_business_id, -v_loaded, -v_cogs, 'sale_out', 'sale', r.id, r.ts, v_product);
        if v_shrink_kg > 0 then
          perform public._inv_apply(p_business_id, -v_shrink_kg, -v_shrink_val, 'shrinkage', 'sale', r.id, r.ts, v_product);
        end if;

      elsif r.kind = 'count' then
        v_counted := r.counted;
        v_new_val := case when v_qty > 0 then round(v_val::numeric * v_counted / v_qty)::bigint else 0 end;
        update public.stock_counts
           set book_kg = v_qty, variance_kg = round(v_counted - v_qty, 2),
               adjustment_value_centavos = v_new_val - v_val
         where id = r.id;
        perform public._inv_apply(p_business_id, round(v_counted - v_qty, 2), v_new_val - v_val,
                                  'count_adj', 'stock_count', r.id, r.ts, v_product);
        v_qty := v_counted; v_val := v_new_val;
      end if;
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- post_purchase — + p_product; price looked up per product; stock-in per product.
-- ----------------------------------------------------------------------------
drop function if exists public.post_purchase(
  uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric,
  bigint, bigint, text, text, uuid, jsonb);

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
  p_weighings             jsonb default null,
  p_product               text default 'copra'
)
returns public.purchases
language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_product     text := coalesce(p_product, 'copra');
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
  if v_business_id is null then raise exception 'No business context for current user'; end if;
  if v_product not in ('copra','charcoal') then raise exception 'Invalid product'; end if;

  if p_client_uuid is not null then
    select * into v_existing from public.purchases
      where business_id = v_business_id and client_uuid = p_client_uuid;
    if found then return v_existing; end if;
  end if;

  perform 1 from public.farmers where id = p_farmer_id and business_id = v_business_id;
  if not found then raise exception 'Farmer not found in this business'; end if;

  select price_per_kg_centavos into v_price
    from public.buying_prices
    where business_id = v_business_id and product = v_product
      and effective_date = (p_purchased_at at time zone 'Asia/Manila')::date
      and grade_id is not distinct from p_grade_id;
  if not found then
    select price_per_kg_centavos into v_price
      from public.buying_prices
      where business_id = v_business_id and product = v_product
        and effective_date = (p_purchased_at at time zone 'Asia/Manila')::date
        and grade_id is null;
  end if;
  if v_price is null then raise exception 'Buying price is not set for this date/grade'; end if;
  if p_price_per_kg_centavos is not null and p_price_per_kg_centavos <> v_price then
    raise exception 'Price has changed since this was recorded (was %, now %)', p_price_per_kg_centavos, v_price;
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
    raise exception 'Net kg cannot be negative (gross % tare % deduction %)', v_gross_kg, p_tare_kg, p_deduction_kg;
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
    cash_paid_centavos, remarks, scale_photo_url, client_uuid, status, created_by, product
  ) values (
    v_business_id, v_receipt_no, p_farmer_id, p_grade_id, coalesce(p_purchased_at, now()),
    v_sack_count, v_gross_kg, coalesce(p_tare_kg,0),
    coalesce(p_deduction_kg,0), coalesce(p_deduction_pct,0), v_net_kg,
    v_price, v_gross_amt, coalesce(p_utang_deducted_centavos,0),
    v_cash_paid, p_remarks, p_scale_photo_url, p_client_uuid, 'posted', v_actor, v_product
  ) returning * into v_row;

  if v_has_weighings then
    insert into public.purchase_weighings (business_id, purchase_id, seq, sack_count, weight_kg)
    select v_business_id, v_row.id, (ord)::integer,
           coalesce((elem->>'sacks')::integer, 0), coalesce((elem->>'kg')::numeric, 0)
      from jsonb_array_elements(p_weighings) with ordinality as t(elem, ord);
  end if;

  if coalesce(p_utang_deducted_centavos,0) > 0 then
    insert into public.utang_ledger (
      business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, created_by)
    values (
      v_business_id, p_farmer_id, (v_row.purchased_at at time zone 'Asia/Manila')::date,
      'repayment', p_utang_deducted_centavos, 'purchase_deduction', v_row.id, 'posted', v_actor);
  end if;

  perform public._inv_apply(v_business_id, v_net_kg, v_gross_amt, 'purchase_in',
                            'purchase', v_row.id, v_row.purchased_at, v_product);

  return v_row;
end;
$$;

grant execute on function public.post_purchase(
  uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric,
  bigint, bigint, text, text, uuid, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- post_sale — + p_product; draws from that product's inventory.
-- ----------------------------------------------------------------------------
drop function if exists public.post_sale(
  uuid, date, text, text, numeric, numeric, numeric, numeric, numeric,
  bigint, bigint, text, bigint, bigint, bigint, numeric, text);

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
  p_remarks               text,
  p_product               text default 'copra'
)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_product     text := coalesce(p_product, 'copra');
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
  if not public.is_owner() then raise exception 'Only the owner can record sales'; end if;
  if v_product not in ('copra','charcoal') then raise exception 'Invalid product'; end if;
  if coalesce(p_our_loaded_kg, 0) <= 0 then raise exception 'Loaded kg must be greater than 0'; end if;
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
    from public.inventory_state where business_id = v_business_id and product = v_product for update;
  v_qty := coalesce(v_qty, 0); v_val := coalesce(v_val, 0);
  if v_book > v_qty then
    raise exception 'Not enough % stock: drawing % kg but only % kg on hand', v_product, v_book, v_qty;
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
    shrinkage_flag, remarks, status, created_by, product)
  values (
    v_business_id, v_sale_no, p_buyer_id, coalesce(p_sale_date, (now() at time zone 'Asia/Manila')::date),
    p_plate_no, p_driver,
    v_loaded, coalesce(p_our_avg_deduction_pct, 0), p_buyer_gross_kg, p_buyer_deduction_pct, p_buyer_net_kg,
    coalesce(p_price_per_kg_centavos, 0), coalesce(p_amount_received_centavos, 0), p_payment_method,
    coalesce(p_trucking_centavos, 0), coalesce(p_labor_centavos, 0), coalesce(p_other_expenses_centavos, 0),
    v_book, v_shrink_kg, v_shrink_val, v_cogs,
    (v_book > 0 and (v_shrink_kg / v_book) * 100 > v_threshold),
    p_remarks, 'posted', v_actor, v_product)
  returning * into v_row;

  perform public._inv_apply(v_business_id, -v_loaded, -v_cogs, 'sale_out', 'sale', v_row.id, v_row.sale_date::timestamptz, v_product);
  if v_shrink_kg > 0 then
    perform public._inv_apply(v_business_id, -v_shrink_kg, -v_shrink_val, 'shrinkage', 'sale', v_row.id, v_row.sale_date::timestamptz, v_product);
  end if;

  return v_row;
end;
$$;

grant execute on function public.post_sale(
  uuid, date, text, text, numeric, numeric, numeric, numeric, numeric,
  bigint, bigint, text, bigint, bigint, bigint, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- post_stock_count — + p_product.
-- ----------------------------------------------------------------------------
drop function if exists public.post_stock_count(numeric, date, text);

create or replace function public.post_stock_count(
  p_counted_kg numeric,
  p_count_date date,
  p_remarks    text,
  p_product    text default 'copra'
)
returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_product     text := coalesce(p_product, 'copra');
  v_qty         numeric(12,2);
  v_val         bigint;
  v_new_val     bigint;
  v_row         public.stock_counts;
begin
  if not public.is_owner() then raise exception 'Only the owner can record stock counts'; end if;
  if v_product not in ('copra','charcoal') then raise exception 'Invalid product'; end if;
  if coalesce(p_counted_kg, -1) < 0 then raise exception 'Counted kg must be 0 or more'; end if;

  select qty_on_hand_kg, total_value_centavos into v_qty, v_val
    from public.inventory_state where business_id = v_business_id and product = v_product for update;
  v_qty := coalesce(v_qty, 0); v_val := coalesce(v_val, 0);
  v_new_val := case when v_qty > 0 then round(v_val::numeric * p_counted_kg / v_qty)::bigint else 0 end;

  insert into public.stock_counts (
    business_id, count_date, counted_kg, book_kg, variance_kg,
    adjustment_value_centavos, remarks, status, created_by, product)
  values (
    v_business_id, coalesce(p_count_date, (now() at time zone 'Asia/Manila')::date),
    round(p_counted_kg, 2), v_qty, round(p_counted_kg - v_qty, 2),
    v_new_val - v_val, p_remarks, 'posted', v_actor, v_product)
  returning * into v_row;

  perform public._inv_apply(v_business_id, round(p_counted_kg - v_qty, 2), v_new_val - v_val,
                            'count_adj', 'stock_count', v_row.id, v_row.count_date::timestamptz, v_product);

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, after)
  values (v_business_id, v_actor, 'stock_count', 'stock_count', v_row.id, to_jsonb(v_row));

  return v_row;
end;
$$;

grant execute on function public.post_stock_count(numeric, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- void_purchase / void_sale — reverse the correct product's inventory.
-- ----------------------------------------------------------------------------
create or replace function public.void_purchase(p_purchase_id uuid, p_reason text)
returns public.purchases
language plpgsql security definer set search_path = public as $$
declare v_business_id uuid := public.current_business_id(); v_actor uuid := auth.uid(); v_row public.purchases;
begin
  if not public.is_owner() then raise exception 'Only the owner can void purchases'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A void reason is required'; end if;

  select * into v_row from public.purchases where id = p_purchase_id and business_id = v_business_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_row.status = 'voided' then raise exception 'Purchase is already voided'; end if;

  update public.purchases set status='voided', voided_by=v_actor, void_reason=p_reason, voided_at=now()
    where id = p_purchase_id returning * into v_row;

  if v_row.utang_deducted_centavos > 0 then
    insert into public.utang_ledger (business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, remarks, created_by)
    values (v_business_id, v_row.farmer_id, (now() at time zone 'Asia/Manila')::date,
      'advance', v_row.utang_deducted_centavos, 'void', v_row.id, 'posted',
      'Reversal of voided receipt #' || v_row.receipt_no, v_actor);
  end if;

  perform public._inv_apply(v_business_id, -v_row.net_kg, -v_row.gross_amount_centavos,
                            'purchase_void', 'purchase', v_row.id, now(), v_row.product);

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, reason, before)
  values (v_business_id, v_actor, 'void', 'purchase', v_row.id, p_reason, to_jsonb(v_row));

  return v_row;
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare v_business_id uuid := public.current_business_id(); v_actor uuid := auth.uid(); v_row public.sales;
begin
  if not public.is_owner() then raise exception 'Only the owner can void sales'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A void reason is required'; end if;

  select * into v_row from public.sales where id = p_sale_id and business_id = v_business_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_row.status = 'voided' then raise exception 'Sale is already voided'; end if;

  update public.sales set status='voided', voided_by=v_actor, void_reason=p_reason, voided_at=now()
    where id = p_sale_id returning * into v_row;

  perform public._inv_apply(
    v_business_id, v_row.book_kg, v_row.cost_of_sales_centavos + v_row.shrinkage_value_centavos,
    'sale_void', 'sale', v_row.id, now(), v_row.product);

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, reason, before)
  values (v_business_id, v_actor, 'void', 'sale', v_row.id, p_reason, to_jsonb(v_row));

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Dashboard view: sum stock across products (there can now be two rows).
-- ----------------------------------------------------------------------------
create or replace view public.v_dashboard_today
with (security_invoker = true) as
select
  b.id as business_id,
  (select coalesce(sum(p.net_kg), 0) from public.purchases p
     where p.business_id = b.id and p.status = 'posted'
       and (p.purchased_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
  ) as today_net_kg,
  (select coalesce(sum(p.gross_amount_centavos), 0) from public.purchases p
     where p.business_id = b.id and p.status = 'posted'
       and (p.purchased_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
  )::bigint as today_gross_centavos,
  (select coalesce(sum(p.cash_paid_centavos), 0) from public.purchases p
     where p.business_id = b.id and p.status = 'posted'
       and (p.purchased_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
  )::bigint as today_cash_out_centavos,
  (select count(*) from public.purchases p
     where p.business_id = b.id and p.status = 'posted'
       and (p.purchased_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
  ) as today_purchase_count,
  (select coalesce(sum(vb.balance_centavos), 0) from public.v_farmer_balances vb
     where vb.business_id = b.id
  )::bigint as total_utang_outstanding_centavos,
  coalesce((select sum(qty_on_hand_kg) from public.inventory_state i where i.business_id = b.id), 0) as stock_on_hand_kg,
  coalesce((select sum(total_value_centavos) from public.inventory_state i where i.business_id = b.id), 0)::bigint as stock_value_centavos,
  (coalesce((select sum(qty_on_hand_kg) from public.inventory_state i where i.business_id = b.id), 0)
     * coalesce((select price_per_kg_centavos from public.buyer_reference_prices brp
          where brp.business_id = b.id
          order by brp.effective_date desc limit 1), 0))::bigint as stock_value_at_buyer_centavos,
  (select coalesce(sum(sp.net_profit_centavos), 0) from public.v_sale_profit sp
     where sp.business_id = b.id
       and date_trunc('month', sp.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  )::bigint as month_net_profit_centavos,
  (select coalesce(sum(sp.gross_profit_centavos), 0) from public.v_sale_profit sp
     where sp.business_id = b.id
       and date_trunc('month', sp.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  )::bigint as month_gross_profit_centavos,
  (select round(avg(r.running_avg_deduction_gap_pct), 2) from public.v_sale_reconciliation r
     where r.business_id = b.id
  ) as avg_deduction_gap_pct,
  (select case when sum(s.book_kg) > 0
               then round(sum(s.shrinkage_kg) / sum(s.book_kg) * 100, 2) else 0 end
     from public.sales s
     where s.business_id = b.id and s.status = 'posted'
       and date_trunc('month', s.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  ) as month_shrinkage_pct
from public.businesses b;

grant select on public.v_dashboard_today to authenticated;
