-- ----------------------------------------------------------------------------
-- CopraBooks — owner correction for a cash account balance.
--
-- Cash/bank/GCash balances are derived from journal lines, so they cannot be
-- edited directly. This posts a balancing adjustment that moves the account to
-- the entered amount, with the difference booked against Owner's Capital. The
-- entry is manual so a journal rebuild preserves it.
-- ----------------------------------------------------------------------------
create or replace function public.adjust_cash_balance(
  p_cash_account_id     uuid,
  p_new_balance_centavos bigint,
  p_remarks             text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_biz     uuid := public.current_business_id();
  v_gl      uuid;
  v_name    text;
  v_current bigint;
  v_delta   bigint;
  v_cap     uuid;
  v_memo    text;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can adjust cash balances'; end if;
  if p_new_balance_centavos is null or p_new_balance_centavos < 0 then
    raise exception 'Enter a valid balance';
  end if;

  select gl_account_id, name into v_gl, v_name
    from public.cash_accounts where id = p_cash_account_id and business_id = v_biz;
  if v_gl is null then raise exception 'Invalid cash account'; end if;

  select coalesce(sum(debit_centavos - credit_centavos), 0) into v_current
    from public.journal_lines where account_id = v_gl and business_id = v_biz;

  v_delta := p_new_balance_centavos - v_current;
  if v_delta = 0 then return; end if;

  v_cap  := public._gl(v_biz, '3000'); -- Owner's Capital
  v_memo := coalesce(nullif(trim(p_remarks), ''), 'Cash balance correction — ' || v_name);

  if v_delta > 0 then
    perform public._insert_journal(v_biz, (now() at time zone 'Asia/Manila')::date,
      'cash_adjustment', null, v_memo, true, auth.uid(),
      jsonb_build_array(
        jsonb_build_object('account_id', v_gl,  'debit',  v_delta, 'memo', v_memo),
        jsonb_build_object('account_id', v_cap, 'credit', v_delta)
      ), false);
  else
    perform public._insert_journal(v_biz, (now() at time zone 'Asia/Manila')::date,
      'cash_adjustment', null, v_memo, true, auth.uid(),
      jsonb_build_array(
        jsonb_build_object('account_id', v_cap, 'debit',  -v_delta),
        jsonb_build_object('account_id', v_gl,  'credit', -v_delta, 'memo', v_memo)
      ), false);
  end if;
end;
$$;

grant execute on function public.adjust_cash_balance(uuid, bigint, text) to authenticated;
