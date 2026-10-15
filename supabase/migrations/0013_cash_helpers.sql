-- ============================================================================
-- CopraBooks — Phase 3 cash helpers callable by both roles.
--   The general ledger is owner-only, but the cashier needs cash-account
--   balances and the expected drawer to do the end-of-day count. These
--   SECURITY DEFINER functions expose only cash figures, scoped to the
--   caller's business.
-- ============================================================================

create or replace function public.cash_balances()
returns table (cash_account_id uuid, name text, type text, balance_centavos bigint)
language sql stable security definer set search_path = public as $$
  select ca.id, ca.name, ca.type,
    coalesce((
      select sum(jl.debit_centavos - jl.credit_centavos)
      from public.journal_lines jl
      where jl.account_id = ca.gl_account_id
    ), 0)::bigint
  from public.cash_accounts ca
  where ca.business_id = public.current_business_id()
  order by ca.type, ca.name;
$$;

create or replace function public.cash_day_expected(p_business_date date)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_biz uuid := public.current_business_id();
  v_open bigint;
begin
  select opening_float_centavos into v_open
    from public.cash_days where business_id = v_biz and business_date = p_business_date;
  return public.cash_expected_centavos(v_biz, p_business_date, coalesce(v_open, 0));
end;
$$;

grant execute on function public.cash_balances() to authenticated;
grant execute on function public.cash_day_expected(date) to authenticated;
