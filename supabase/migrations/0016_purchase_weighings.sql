-- ----------------------------------------------------------------------------
-- CopraBooks — per-weighing (batch) detail for purchases.
--
-- Copra is weighed in batches of sacks (often 5–10 separate weighings) before
-- the totals are struck. This records each weighing line so the totals
-- (sack_count, gross_kg) are an auditable sum and the detail can be reprinted
-- on the receipt.
-- ----------------------------------------------------------------------------

create table public.purchase_weighings (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  seq         integer not null check (seq >= 1),
  sack_count  integer not null default 0 check (sack_count >= 0),
  weight_kg   numeric(12,2) not null check (weight_kg >= 0),
  created_at  timestamptz not null default now(),
  constraint purchase_weighings_seq_unique unique (purchase_id, seq)
);
create index purchase_weighings_purchase_idx on public.purchase_weighings (purchase_id);

alter table public.purchase_weighings enable row level security;

-- Read-only for clients (same business); writes happen via the definer
-- function post_purchase, which runs as the table owner and bypasses RLS.
create policy purchase_weighings_select on public.purchase_weighings
  for select using (business_id = public.current_business_id());

grant select, insert, update, delete on public.purchase_weighings to authenticated;

-- ----------------------------------------------------------------------------
-- Recreate post_purchase with an optional p_weighings jsonb argument. When
-- weighings are supplied, the sack count and gross kg are derived from their
-- sums (the receipt lines then always reconcile with the totals) and each line
-- is stored. Existing callers that omit p_weighings keep working unchanged.
-- ----------------------------------------------------------------------------
drop function if exists public.post_purchase(
  uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric,
  bigint, bigint, text, text, uuid
);

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

  -- Idempotency: return the already-synced purchase unchanged.
  if p_client_uuid is not null then
    select * into v_existing from public.purchases
      where business_id = v_business_id and client_uuid = p_client_uuid;
    if found then
      return v_existing;
    end if;
  end if;

  -- Farmer must belong to this business.
  perform 1 from public.farmers
    where id = p_farmer_id and business_id = v_business_id;
  if not found then
    raise exception 'Farmer not found in this business';
  end if;

  -- The buying price for that day + grade must be set, and it is locked onto
  -- the transaction server-side (the client's value is not trusted). Prefer an
  -- exact grade match, then fall back to an ungraded price for the day.
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
  -- Guard against a stale offline price: reject if the client's value differs.
  if p_price_per_kg_centavos is not null and p_price_per_kg_centavos <> v_price then
    raise exception 'Price has changed since this was recorded (was %, now %)',
      p_price_per_kg_centavos, v_price;
  end if;

  -- Totals come from the weighing breakdown when provided, else the scalars.
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

  -- Utang deducted cannot exceed the gross amount nor the farmer's balance.
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

  -- Store the individual weighings (batches of sacks) in order.
  if v_has_weighings then
    insert into public.purchase_weighings (
      business_id, purchase_id, seq, sack_count, weight_kg
    )
    select v_business_id, v_row.id, (ord)::integer,
           coalesce((elem->>'sacks')::integer, 0),
           coalesce((elem->>'kg')::numeric, 0)
      from jsonb_array_elements(p_weighings) with ordinality as t(elem, ord);
  end if;

  -- Record the utang repayment (posted immediately).
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

  return v_row;
end;
$$;

grant execute on function public.post_purchase(
  uuid, uuid, timestamptz, integer, numeric, numeric, numeric, numeric,
  bigint, bigint, text, text, uuid, jsonb
) to authenticated;
