-- ============================================================================
-- CopraBooks — Phase 3 posting engine, triggers, and write RPCs.
--   Per-source posting functions build balanced journal entries and are reused
--   by (a) AFTER triggers on the source tables (live posting) and (b)
--   rebuild_journal() (historical backfill / repair). Phase 1/2 RPCs are left
--   untouched — posting is driven entirely by triggers.
-- ============================================================================

-- Resolve a GL account id by code.
create or replace function public._gl(p_biz uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.gl_accounts where business_id = p_biz and code = p_code;
$$;

-- Cash account's GL account id.
create or replace function public._cash_gl(p_cash_account_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select gl_account_id from public.cash_accounts where id = p_cash_account_id;
$$;

-- ----------------------------------------------------------------------------
-- _insert_journal — core entry writer. Lines is a jsonb array of objects with
-- either {code} or {account_id}, plus {debit}/{credit}/{memo}. Zero-amount
-- lines are skipped. Ensures the period exists; rejects a closed period unless
-- p_allow_closed. The deferred constraint trigger validates balance at commit.
-- ----------------------------------------------------------------------------
create or replace function public._insert_journal(
  p_biz uuid, p_date date, p_source_type text, p_source_id uuid, p_memo text,
  p_is_manual boolean, p_created_by uuid, p_lines jsonb, p_allow_closed boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from p_date);
  v_month int := extract(month from p_date);
  v_period uuid;
  v_status text;
  v_entry uuid;
  v_no bigint;
  v_acct uuid;
  v_debit bigint;
  v_credit bigint;
  l jsonb;
begin
  select id, status into v_period, v_status
    from public.accounting_periods
    where business_id = p_biz and year = v_year and month = v_month;
  if not found then
    insert into public.accounting_periods (business_id, year, month)
      values (p_biz, v_year, v_month) returning id into v_period;
  elsif v_status = 'closed' and not p_allow_closed then
    raise exception 'Accounting period %-% is closed', v_year, v_month;
  end if;

  v_no := public.allocate_document_number(p_biz, 'journal');
  insert into public.journal_entries (
    business_id, entry_no, entry_date, source_type, source_id, memo, is_manual,
    period_id, created_by)
  values (p_biz, v_no, p_date, p_source_type, p_source_id, p_memo,
          coalesce(p_is_manual, false), v_period, p_created_by)
  returning id into v_entry;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((l->>'debit')::bigint, 0);
    v_credit := coalesce((l->>'credit')::bigint, 0);
    if v_debit = 0 and v_credit = 0 then continue; end if;
    if l ? 'account_id' then
      v_acct := (l->>'account_id')::uuid;
    else
      v_acct := public._gl(p_biz, l->>'code');
    end if;
    if v_acct is null then
      raise exception 'GL account not found for line %', l;
    end if;
    insert into public.journal_lines (
      entry_id, business_id, account_id, debit_centavos, credit_centavos, line_memo)
    values (v_entry, p_biz, v_acct, v_debit, v_credit, l->>'memo');
  end loop;

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- _reverse_source_journal — post a mirror of the latest posted entry for a
-- source document, and flag the original reversed.
-- ----------------------------------------------------------------------------
create or replace function public._reverse_source_journal(
  p_biz uuid, p_source_type text, p_source_id uuid, p_memo text,
  p_created_by uuid, p_allow_closed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig uuid;
  v_date date;
  v_year int;
  v_month int;
  v_period uuid;
  v_status text;
  v_entry uuid;
  v_no bigint;
  r record;
begin
  select id, entry_date into v_orig, v_date
    from public.journal_entries
    where business_id = p_biz and source_type = p_source_type and source_id = p_source_id
      and status = 'posted' and is_manual = false
    order by entry_no desc limit 1;
  if not found then return; end if;

  v_year := extract(year from v_date); v_month := extract(month from v_date);
  select id, status into v_period, v_status
    from public.accounting_periods where business_id = p_biz and year = v_year and month = v_month;
  if v_status = 'closed' and not p_allow_closed then
    raise exception 'Accounting period %-% is closed', v_year, v_month;
  end if;

  v_no := public.allocate_document_number(p_biz, 'journal');
  insert into public.journal_entries (
    business_id, entry_no, entry_date, source_type, source_id, memo, is_manual,
    period_id, created_by, reverses_entry_id)
  values (p_biz, v_no, v_date, p_source_type || '_void', p_source_id, p_memo, false,
          v_period, p_created_by, v_orig)
  returning id into v_entry;

  for r in select account_id, debit_centavos, credit_centavos, line_memo
             from public.journal_lines where entry_id = v_orig loop
    insert into public.journal_lines (
      entry_id, business_id, account_id, debit_centavos, credit_centavos, line_memo)
    values (v_entry, p_biz, r.account_id, r.credit_centavos, r.debit_centavos, r.line_memo);
  end loop;

  update public.journal_entries
     set status = 'reversed', reversed_by_entry_id = v_entry
   where id = v_orig;
end;
$$;

-- ----------------------------------------------------------------------------
-- Per-source posting functions
-- ----------------------------------------------------------------------------
create or replace function public._post_purchase_journal(p public.purchases, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if p.status <> 'posted' then return; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('code', '1200', 'debit', p.gross_amount_centavos, 'memo', 'Copra inventory'));
  if p.cash_paid_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '1000', 'credit', p.cash_paid_centavos));
  end if;
  if p.utang_deducted_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '1100', 'credit', p.utang_deducted_centavos));
  end if;
  perform public._insert_journal(p.business_id, (p.purchased_at at time zone 'Asia/Manila')::date,
    'purchase', p.id, 'Purchase receipt #' || p.receipt_no, false, p.created_by, v_lines, p_allow_closed);
end;
$$;

create or replace function public._post_utang_journal(u public.utang_ledger, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if u.status <> 'posted' then return; end if;
  if u.source_type = 'cash_advance' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '1100', 'debit', u.amount_centavos, 'memo', 'Advance to farmer'),
      jsonb_build_object('code', '1000', 'credit', u.amount_centavos));
  elsif u.source_type = 'direct_cash' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '1000', 'debit', u.amount_centavos, 'memo', 'Utang repayment (cash)'),
      jsonb_build_object('code', '1100', 'credit', u.amount_centavos));
  else
    return;  -- purchase_deduction is captured in the purchase entry; void/adjustment skipped
  end if;
  perform public._insert_journal(u.business_id, u.entry_date, 'utang', u.id,
    initcap(replace(u.source_type, '_', ' ')), false, u.created_by, v_lines, p_allow_closed);
end;
$$;

create or replace function public._post_sale_journal(s public.sales, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb;
  v_pay_code text;
  v_exp bigint;
begin
  if s.status <> 'posted' then return; end if;
  v_pay_code := case s.payment_method when 'bank' then '1010' when 'gcash' then '1020' else '1000' end;
  v_exp := s.trucking_centavos + s.labor_centavos + s.other_expenses_centavos;

  v_lines := jsonb_build_array(
    jsonb_build_object('code', v_pay_code, 'debit', s.amount_received_centavos, 'memo', 'Sale proceeds'),
    jsonb_build_object('code', '4000', 'credit', s.amount_received_centavos));
  if s.cost_of_sales_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '5000', 'debit', s.cost_of_sales_centavos));
  end if;
  if s.shrinkage_value_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '5100', 'debit', s.shrinkage_value_centavos));
  end if;
  if (s.cost_of_sales_centavos + s.shrinkage_value_centavos) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '1200', 'credit', s.cost_of_sales_centavos + s.shrinkage_value_centavos));
  end if;
  if s.trucking_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '6000', 'debit', s.trucking_centavos));
  end if;
  if s.labor_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '6100', 'debit', s.labor_centavos));
  end if;
  if s.other_expenses_centavos > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '6900', 'debit', s.other_expenses_centavos));
  end if;
  if v_exp > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('code', '1000', 'credit', v_exp, 'memo', 'Truckload expenses'));
  end if;

  perform public._insert_journal(s.business_id, s.sale_date, 'sale', s.id,
    'Sale #' || s.sale_no, false, s.created_by, v_lines, p_allow_closed);
end;
$$;

create or replace function public._post_stock_count_journal(sc public.stock_counts, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v bigint;
begin
  if sc.status <> 'posted' then return; end if;
  v := sc.adjustment_value_centavos;
  if v = 0 then return; end if;
  if v < 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '5100', 'debit', -v, 'memo', 'Stock count shortage'),
      jsonb_build_object('code', '1200', 'credit', -v));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '1200', 'debit', v, 'memo', 'Stock count overage'),
      jsonb_build_object('code', '5100', 'credit', v));
  end if;
  perform public._insert_journal(sc.business_id, sc.count_date, 'stock_count', sc.id,
    'Stock count', false, sc.created_by, v_lines, p_allow_closed);
end;
$$;

create or replace function public._post_expense_journal(e public.expenses, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if e.status <> 'posted' then return; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', e.expense_account_id, 'debit', e.amount_centavos, 'memo', coalesce(e.remarks, 'Expense')),
    jsonb_build_object('account_id', public._cash_gl(e.cash_account_id), 'credit', e.amount_centavos));
  perform public._insert_journal(e.business_id, e.expense_date, 'expense', e.id,
    coalesce(e.remarks, 'Expense'), false, e.created_by, v_lines, p_allow_closed);
end;
$$;

create or replace function public._post_equity_journal(eq public.equity_transactions, p_allow_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if eq.status <> 'posted' then return; end if;
  if eq.type = 'capital_in' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', public._cash_gl(eq.cash_account_id), 'debit', eq.amount_centavos, 'memo', 'Owner capital in'),
      jsonb_build_object('code', '3000', 'credit', eq.amount_centavos));
  elsif eq.type = 'drawing' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', '3100', 'debit', eq.amount_centavos, 'memo', 'Owner drawing'),
      jsonb_build_object('account_id', public._cash_gl(eq.cash_account_id), 'credit', eq.amount_centavos));
  elsif eq.type = 'transfer' then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', public._cash_gl(eq.to_account_id), 'debit', eq.amount_centavos, 'memo', 'Transfer in'),
      jsonb_build_object('account_id', public._cash_gl(eq.from_account_id), 'credit', eq.amount_centavos));
  else
    return;
  end if;
  perform public._insert_journal(eq.business_id, eq.txn_date, 'equity', eq.id,
    initcap(replace(eq.type, '_', ' ')), false, eq.created_by, v_lines, p_allow_closed);
end;
$$;

-- ----------------------------------------------------------------------------
-- Triggers on the source tables
-- ----------------------------------------------------------------------------
create or replace function public.trg_purchase_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_purchase_journal(new, false);
  elsif tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'voided' then
    perform public._reverse_source_journal(new.business_id, 'purchase', new.id,
      'Void receipt #' || new.receipt_no, new.voided_by, false);
  end if;
  return null;
end;
$$;
create trigger purchases_journal after insert or update of status on public.purchases
  for each row execute function public.trg_purchase_journal();

create or replace function public.trg_utang_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_utang_journal(new, false);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'posted' then
    perform public._post_utang_journal(new, false);
  end if;
  return null;
end;
$$;
create trigger utang_journal after insert or update of status on public.utang_ledger
  for each row execute function public.trg_utang_journal();

create or replace function public.trg_sale_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_sale_journal(new, false);
  elsif tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'voided' then
    perform public._reverse_source_journal(new.business_id, 'sale', new.id,
      'Void sale #' || new.sale_no, new.voided_by, false);
  end if;
  return null;
end;
$$;
create trigger sales_journal after insert or update of status on public.sales
  for each row execute function public.trg_sale_journal();

create or replace function public.trg_stock_count_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_stock_count_journal(new, false);
  end if;
  return null;
end;
$$;
create trigger stock_counts_journal after insert on public.stock_counts
  for each row execute function public.trg_stock_count_journal();

create or replace function public.trg_expense_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_expense_journal(new, false);
  elsif tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'voided' then
    perform public._reverse_source_journal(new.business_id, 'expense', new.id,
      'Void expense', new.voided_by, false);
  end if;
  return null;
end;
$$;
create trigger expenses_journal after insert or update of status on public.expenses
  for each row execute function public.trg_expense_journal();

create or replace function public.trg_equity_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'posted' then
    perform public._post_equity_journal(new, false);
  end if;
  return null;
end;
$$;
create trigger equity_journal after insert on public.equity_transactions
  for each row execute function public.trg_equity_journal();

-- ----------------------------------------------------------------------------
-- Default chart of accounts + cash accounts
-- ----------------------------------------------------------------------------
create or replace function public.seed_default_accounts(p_biz uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.gl_accounts (business_id, code, name, type, normal_balance, is_cash, is_system, sort_order) values
    (p_biz, '1000', 'Cash on Hand',        'asset',     'debit',  true,  true, 10),
    (p_biz, '1010', 'Cash in Bank',        'asset',     'debit',  true,  true, 20),
    (p_biz, '1020', 'GCash',               'asset',     'debit',  true,  true, 30),
    (p_biz, '1100', 'Advances to Farmers', 'asset',     'debit',  false, true, 40),
    (p_biz, '1200', 'Copra Inventory',     'asset',     'debit',  false, true, 50),
    (p_biz, '3000', 'Owner''s Capital',    'equity',    'credit', false, true, 60),
    (p_biz, '3100', 'Owner''s Drawings',   'equity',    'debit',  false, true, 70),
    (p_biz, '4000', 'Sales',               'income',    'credit', false, true, 80),
    (p_biz, '5000', 'Cost of Sales',       'expense',   'debit',  false, true, 90),
    (p_biz, '5100', 'Inventory Shrinkage', 'expense',   'debit',  false, true, 100),
    (p_biz, '6000', 'Trucking',            'expense',   'debit',  false, true, 110),
    (p_biz, '6100', 'Labor',               'expense',   'debit',  false, true, 120),
    (p_biz, '6200', 'Sacks/Supplies',      'expense',   'debit',  false, false, 130),
    (p_biz, '6300', 'Utilities',           'expense',   'debit',  false, false, 140),
    (p_biz, '6400', 'Rent',                'expense',   'debit',  false, false, 150),
    (p_biz, '6900', 'Other Expenses',      'expense',   'debit',  false, true, 160)
  on conflict (business_id, code) do nothing;

  insert into public.cash_accounts (business_id, name, type, gl_account_id)
    select p_biz, 'Cash on Hand', 'cash_on_hand', id from public.gl_accounts where business_id = p_biz and code = '1000'
    on conflict (business_id, name) do nothing;
  insert into public.cash_accounts (business_id, name, type, gl_account_id)
    select p_biz, 'Cash in Bank', 'bank', id from public.gl_accounts where business_id = p_biz and code = '1010'
    on conflict (business_id, name) do nothing;
  insert into public.cash_accounts (business_id, name, type, gl_account_id)
    select p_biz, 'GCash', 'gcash', id from public.gl_accounts where business_id = p_biz and code = '1020'
    on conflict (business_id, name) do nothing;
end;
$$;

-- Provision accounts for a brand-new business on signup.
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
    perform public.seed_default_accounts(v_business_id);
  end if;

  select exists(select 1 from public.profiles where business_id = v_business_id and role = 'owner')
    into v_has_owner;
  if not v_has_owner then
    v_role := 'owner';
  else
    v_role := coalesce(new.raw_user_meta_data->>'role', 'cashier');
    if v_role not in ('owner', 'cashier') then v_role := 'cashier'; end if;
  end if;

  insert into public.profiles (id, business_id, role, full_name)
  values (new.id, v_business_id, v_role, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- rebuild_journal — regenerate all auto (non-manual) entries from source docs.
-- Backfill for Phase 1/2 data and repair. Manual entries are preserved.
-- ----------------------------------------------------------------------------
create or replace function public.rebuild_journal(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p  public.purchases%rowtype;
  v_u  public.utang_ledger%rowtype;
  v_s  public.sales%rowtype;
  v_sc public.stock_counts%rowtype;
  v_e  public.expenses%rowtype;
  v_eq public.equity_transactions%rowtype;
begin
  delete from public.journal_entries where business_id = p_business_id and is_manual = false;

  for v_p in select * from public.purchases
               where business_id = p_business_id and status = 'posted'
               order by purchased_at, created_at loop
    perform public._post_purchase_journal(v_p, true);
  end loop;

  for v_u in select * from public.utang_ledger
               where business_id = p_business_id and status = 'posted'
                 and source_type in ('cash_advance', 'direct_cash')
               order by entry_date, created_at loop
    perform public._post_utang_journal(v_u, true);
  end loop;

  for v_s in select * from public.sales
               where business_id = p_business_id and status = 'posted'
               order by sale_date, created_at loop
    perform public._post_sale_journal(v_s, true);
  end loop;

  for v_sc in select * from public.stock_counts
                where business_id = p_business_id and status = 'posted'
                order by count_date, created_at loop
    perform public._post_stock_count_journal(v_sc, true);
  end loop;

  for v_e in select * from public.expenses
               where business_id = p_business_id and status = 'posted'
               order by expense_date, created_at loop
    perform public._post_expense_journal(v_e, true);
  end loop;

  for v_eq in select * from public.equity_transactions
                where business_id = p_business_id and status = 'posted'
                order by txn_date, created_at loop
    perform public._post_equity_journal(v_eq, true);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Write RPCs (cash management, expenses, manual journal, period close)
-- ----------------------------------------------------------------------------
create or replace function public.post_expense(
  p_expense_account_id uuid, p_cash_account_id uuid, p_amount_centavos bigint,
  p_expense_date date, p_remarks text, p_receipt_photo_url text)
returns public.expenses
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.expenses;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if coalesce(p_amount_centavos,0) <= 0 then raise exception 'Amount must be positive'; end if;
  perform 1 from public.gl_accounts where id = p_expense_account_id and business_id = v_biz and type = 'expense';
  if not found then raise exception 'Invalid expense account'; end if;
  perform 1 from public.cash_accounts where id = p_cash_account_id and business_id = v_biz;
  if not found then raise exception 'Invalid cash account'; end if;

  insert into public.expenses (business_id, expense_date, expense_account_id, cash_account_id,
    amount_centavos, remarks, receipt_photo_url, created_by)
  values (v_biz, coalesce(p_expense_date, (now() at time zone 'Asia/Manila')::date),
    p_expense_account_id, p_cash_account_id, p_amount_centavos, p_remarks, p_receipt_photo_url, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns public.expenses
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.expenses;
begin
  if not public.is_owner() then raise exception 'Only the owner can void expenses'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A void reason is required'; end if;
  update public.expenses set status='voided', voided_by=auth.uid(), void_reason=p_reason, voided_at=now()
    where id=p_expense_id and business_id=v_biz and status='posted'
  returning * into v_row;
  if not found then raise exception 'Expense not found or already voided'; end if;
  return v_row;
end;
$$;

create or replace function public.record_equity(
  p_type text, p_amount_centavos bigint, p_cash_account_id uuid,
  p_from_account_id uuid, p_to_account_id uuid, p_txn_date date, p_remarks text)
returns public.equity_transactions
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.equity_transactions;
begin
  if not public.is_owner() then raise exception 'Only the owner can record capital, drawings or transfers'; end if;
  if coalesce(p_amount_centavos,0) <= 0 then raise exception 'Amount must be positive'; end if;
  if p_type not in ('capital_in','drawing','transfer') then raise exception 'Invalid type'; end if;
  if p_type = 'transfer' and (p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id) then
    raise exception 'Transfer needs distinct from/to accounts';
  end if;
  if p_type in ('capital_in','drawing') and p_cash_account_id is null then
    raise exception 'A cash account is required';
  end if;

  insert into public.equity_transactions (business_id, txn_date, type, amount_centavos,
    cash_account_id, from_account_id, to_account_id, remarks, created_by)
  values (v_biz, coalesce(p_txn_date, (now() at time zone 'Asia/Manila')::date), p_type, p_amount_centavos,
    p_cash_account_id, p_from_account_id, p_to_account_id, p_remarks, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_manual_journal(
  p_entry_date date, p_memo text, p_lines jsonb)
returns public.journal_entries
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_id uuid; v_row public.journal_entries;
begin
  if not public.is_owner() then raise exception 'Only the owner can post manual journal entries'; end if;
  if jsonb_array_length(p_lines) < 2 then raise exception 'At least two lines are required'; end if;
  v_id := public._insert_journal(v_biz, coalesce(p_entry_date, (now() at time zone 'Asia/Manila')::date),
    'manual', null, p_memo, true, auth.uid(), p_lines, false);
  select * into v_row from public.journal_entries where id = v_id;
  return v_row;
end;
$$;

create or replace function public.close_period(p_year int, p_month int)
returns public.accounting_periods
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.accounting_periods;
begin
  if not public.is_owner() then raise exception 'Only the owner can close a period'; end if;
  insert into public.accounting_periods (business_id, year, month, status, closed_by, closed_at)
    values (v_biz, p_year, p_month, 'closed', auth.uid(), now())
  on conflict (business_id, year, month) do update
    set status='closed', closed_by=auth.uid(), closed_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reopen_period(p_year int, p_month int)
returns public.accounting_periods
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.accounting_periods;
begin
  if not public.is_owner() then raise exception 'Only the owner can reopen a period'; end if;
  update public.accounting_periods set status='open', closed_by=null, closed_at=null
    where business_id=v_biz and year=p_year and month=p_month
  returning * into v_row;
  if not found then raise exception 'Period not found'; end if;
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Cash day cycle
-- ----------------------------------------------------------------------------
-- Expected Cash on Hand for a date = opening float + net GL movement on 1000.
create or replace function public.cash_expected_centavos(p_biz uuid, p_date date, p_opening bigint)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(p_opening,0) + coalesce((
    select sum(jl.debit_centavos - jl.credit_centavos)
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    join public.gl_accounts a on a.id = jl.account_id
    where a.business_id = p_biz and a.code = '1000' and je.entry_date = p_date
  ), 0)::bigint;
$$;

create or replace function public.open_cash_day(p_business_date date, p_opening_float_centavos bigint)
returns public.cash_days
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.cash_days;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  insert into public.cash_days (business_id, business_date, opening_float_centavos, opened_by)
  values (v_biz, coalesce(p_business_date, (now() at time zone 'Asia/Manila')::date),
    coalesce(p_opening_float_centavos,0), auth.uid())
  on conflict (business_id, business_date) do update
    set opening_float_centavos = excluded.opening_float_centavos
    where public.cash_days.status = 'open'
  returning * into v_row;
  if v_row.id is null then raise exception 'Day already closed/counted; cannot change opening float'; end if;
  return v_row;
end;
$$;

create or replace function public.record_cash_count(
  p_business_date date, p_counted_centavos bigint, p_denominations jsonb)
returns public.cash_counts
language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid := public.current_business_id();
  v_day public.cash_days;
  v_expected bigint;
  v_row public.cash_counts;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  select * into v_day from public.cash_days where business_id=v_biz and business_date=p_business_date for update;
  if not found then raise exception 'Open the cash day first'; end if;
  if v_day.status = 'closed' then raise exception 'Day is already closed'; end if;

  v_expected := public.cash_expected_centavos(v_biz, p_business_date, v_day.opening_float_centavos);

  insert into public.cash_counts (business_id, cash_day_id, counted_centavos, expected_centavos,
    variance_centavos, denominations, counted_by)
  values (v_biz, v_day.id, p_counted_centavos, v_expected, p_counted_centavos - v_expected,
    p_denominations, auth.uid())
  returning * into v_row;

  update public.cash_days set status='counted' where id = v_day.id;
  return v_row;
end;
$$;

create or replace function public.close_cash_day(p_business_date date)
returns public.cash_days
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_row public.cash_days;
begin
  if not public.is_owner() then raise exception 'Only the owner can approve the day close'; end if;
  update public.cash_days set status='closed', approved_by=auth.uid(), closed_by=auth.uid(), closed_at=now()
    where business_id=v_biz and business_date=p_business_date and status='counted'
  returning * into v_row;
  if not found then raise exception 'Day must be counted before it can be closed'; end if;
  return v_row;
end;
$$;
