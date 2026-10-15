-- ============================================================================
-- CopraBooks — Phase 1 functions & triggers
--   * Identity helpers used by RLS.
--   * Document-number allocation (sequential, never reused).
--   * SECURITY DEFINER write functions for append-only financial records.
--   * handle_new_user: provisions a profile on signup.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Identity helpers (STABLE; safe to call inside RLS policies)
-- ----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'owner', false);
$$;

-- ----------------------------------------------------------------------------
-- Allocate the next document number atomically.
-- ----------------------------------------------------------------------------
create or replace function public.allocate_document_number(p_business_id uuid, p_doc_type text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  insert into public.document_counters (business_id, doc_type, next_number)
  values (p_business_id, p_doc_type, 1)
  on conflict (business_id, doc_type) do nothing;

  update public.document_counters
     set next_number = next_number + 1
   where business_id = p_business_id
     and doc_type = p_doc_type
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- Farmer utang balance (posted rows only), in centavos.
-- ----------------------------------------------------------------------------
create or replace function public.farmer_balance_centavos(p_farmer_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when direction = 'advance' then amount_centavos else -amount_centavos end
  ), 0)::bigint
  from public.utang_ledger
  where farmer_id = p_farmer_id
    and status = 'posted';
$$;

-- ----------------------------------------------------------------------------
-- post_purchase — records a purchase, deducts utang, allocates a receipt no.
--   Idempotent on client_uuid (offline sync safe).
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

  v_net_kg := round(coalesce(p_gross_kg,0) - coalesce(p_tare_kg,0) - coalesce(p_deduction_kg,0), 2);
  if v_net_kg < 0 then
    raise exception 'Net kg cannot be negative (gross % tare % deduction %)',
      p_gross_kg, p_tare_kg, p_deduction_kg;
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
    coalesce(p_sack_count,0), coalesce(p_gross_kg,0), coalesce(p_tare_kg,0),
    coalesce(p_deduction_kg,0), coalesce(p_deduction_pct,0), v_net_kg,
    v_price, v_gross_amt, coalesce(p_utang_deducted_centavos,0),
    v_cash_paid, p_remarks, p_scale_photo_url, p_client_uuid, 'posted', v_actor
  ) returning * into v_row;

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

-- ----------------------------------------------------------------------------
-- void_purchase — owner-only reversal. Restores any deducted utang.
-- ----------------------------------------------------------------------------
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
    where id = p_purchase_id and business_id = v_business_id
    for update;
  if not found then
    raise exception 'Purchase not found';
  end if;
  if v_row.status = 'voided' then
    raise exception 'Purchase is already voided';
  end if;

  update public.purchases
     set status = 'voided', voided_by = v_actor, void_reason = p_reason, voided_at = now()
   where id = p_purchase_id
  returning * into v_row;

  -- Restore utang that was repaid by this purchase.
  if v_row.utang_deducted_centavos > 0 then
    insert into public.utang_ledger (
      business_id, farmer_id, entry_date, direction, amount_centavos,
      source_type, source_id, status, remarks, created_by
    ) values (
      v_business_id, v_row.farmer_id,
      (now() at time zone 'Asia/Manila')::date,
      'advance', v_row.utang_deducted_centavos, 'void', v_row.id,
      'posted', 'Reversal of voided receipt #' || v_row.receipt_no, v_actor
    );
  end if;

  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, reason, before)
  values (v_business_id, v_actor, 'void', 'purchase', v_row.id, p_reason, to_jsonb(v_row));

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_advance — cash advance (utang). Over the approval limit, a cashier's
-- advance is held 'pending' for owner approval; the owner's is posted at once.
-- ----------------------------------------------------------------------------
create or replace function public.create_advance(
  p_farmer_id uuid,
  p_amount_centavos bigint,
  p_remarks text
)
returns public.utang_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_limit       bigint;
  v_needs       boolean;
  v_status      text;
  v_row         public.utang_ledger;
begin
  if v_business_id is null then
    raise exception 'No business context for current user';
  end if;
  if coalesce(p_amount_centavos,0) <= 0 then
    raise exception 'Advance amount must be positive';
  end if;

  perform 1 from public.farmers where id = p_farmer_id and business_id = v_business_id;
  if not found then
    raise exception 'Farmer not found in this business';
  end if;

  select advance_approval_limit_centavos into v_limit
    from public.business_settings where business_id = v_business_id;
  v_limit := coalesce(v_limit, 0);

  v_needs := (not public.is_owner()) and (p_amount_centavos > v_limit);
  v_status := case when v_needs then 'pending' else 'posted' end;

  insert into public.utang_ledger (
    business_id, farmer_id, direction, amount_centavos, source_type,
    status, requires_approval, remarks, created_by,
    approved_by, approved_at
  ) values (
    v_business_id, p_farmer_id, 'advance', p_amount_centavos, 'cash_advance',
    v_status, v_needs, p_remarks, v_actor,
    case when v_needs then null else v_actor end,
    case when v_needs then null else now() end
  ) returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- approve_advance / reject_advance — owner acts on a pending advance.
-- ----------------------------------------------------------------------------
create or replace function public.approve_advance(p_ledger_id uuid)
returns public.utang_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_row         public.utang_ledger;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can approve advances';
  end if;
  update public.utang_ledger
     set status = 'posted', approved_by = v_actor, approved_at = now()
   where id = p_ledger_id and business_id = v_business_id and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'Pending advance not found';
  end if;
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, after)
  values (v_business_id, v_actor, 'approve_advance', 'utang_ledger', v_row.id, to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.reject_advance(p_ledger_id uuid, p_reason text)
returns public.utang_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_row         public.utang_ledger;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reject advances';
  end if;
  update public.utang_ledger
     set status = 'rejected', approved_by = v_actor, approved_at = now(),
         remarks = coalesce(remarks, '') ||
                   case when p_reason is not null then ' [rejected: ' || p_reason || ']' else '' end
   where id = p_ledger_id and business_id = v_business_id and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'Pending advance not found';
  end if;
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- record_cash_repayment — farmer pays utang directly in cash.
-- ----------------------------------------------------------------------------
create or replace function public.record_cash_repayment(
  p_farmer_id uuid,
  p_amount_centavos bigint,
  p_remarks text
)
returns public.utang_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_actor       uuid := auth.uid();
  v_balance     bigint;
  v_row         public.utang_ledger;
begin
  if v_business_id is null then
    raise exception 'No business context for current user';
  end if;
  if coalesce(p_amount_centavos,0) <= 0 then
    raise exception 'Repayment amount must be positive';
  end if;

  perform 1 from public.farmers where id = p_farmer_id and business_id = v_business_id;
  if not found then
    raise exception 'Farmer not found in this business';
  end if;

  v_balance := public.farmer_balance_centavos(p_farmer_id);
  if p_amount_centavos > v_balance then
    raise exception 'Repayment (%) exceeds farmer balance (%)', p_amount_centavos, v_balance;
  end if;

  insert into public.utang_ledger (
    business_id, farmer_id, direction, amount_centavos, source_type,
    status, remarks, created_by
  ) values (
    v_business_id, p_farmer_id, 'repayment', p_amount_centavos, 'direct_cash',
    'posted', p_remarks, v_actor
  ) returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- handle_new_user — provision a profile when a user signs up.
--   The first-ever user of the single business becomes owner; thereafter the
--   role comes from signup metadata (default cashier).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_role        text;
  v_has_owner   boolean;
begin
  select id into v_business_id from public.businesses order by created_at limit 1;
  if v_business_id is null then
    insert into public.businesses (name) values ('CopraBooks') returning id into v_business_id;
    insert into public.business_settings (business_id) values (v_business_id);
  end if;

  select exists(select 1 from public.profiles where business_id = v_business_id and role = 'owner')
    into v_has_owner;

  if not v_has_owner then
    v_role := 'owner';
  else
    v_role := coalesce(new.raw_user_meta_data->>'role', 'cashier');
    if v_role not in ('owner', 'cashier') then
      v_role := 'cashier';
    end if;
  end if;

  insert into public.profiles (id, business_id, role, full_name)
  values (new.id, v_business_id, v_role, new.raw_user_meta_data->>'full_name');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
