-- ============================================================================
-- CopraBooks — cash advances capture the farmer's signature.
--   The signature (a small PNG data URL) is stored on the utang_ledger row for
--   audit and printed on the advance receipt. create_advance gains a signature
--   parameter.
-- ============================================================================

alter table public.utang_ledger
  add column if not exists signature_data text;

-- Replace create_advance with a signature-aware version.
drop function if exists public.create_advance(uuid, bigint, text);

create or replace function public.create_advance(
  p_farmer_id uuid,
  p_amount_centavos bigint,
  p_remarks text,
  p_signature text
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
    status, requires_approval, remarks, signature_data, created_by,
    approved_by, approved_at
  ) values (
    v_business_id, p_farmer_id, 'advance', p_amount_centavos, 'cash_advance',
    v_status, v_needs, p_remarks, p_signature, v_actor,
    case when v_needs then null else v_actor end,
    case when v_needs then null else now() end
  ) returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_advance(uuid, bigint, text, text) to authenticated;
