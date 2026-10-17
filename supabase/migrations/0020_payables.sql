-- ----------------------------------------------------------------------------
-- CopraBooks — accounts payable (money the station owes).
--
-- A payable is a bill/obligation the business owes (supplier credit, a loan,
-- unpaid utilities, etc.). Creating one books it as a liability; paying it
-- reduces cash and the liability. Both sides post balanced journal entries so
-- cash balances, the trial balance and the balance sheet stay correct.
--
-- Journals are posted as manual entries (is_manual = true) so rebuild_journal
-- (which only replays the built-in sources) preserves them.
-- ----------------------------------------------------------------------------

-- Accounts Payable liability account for existing businesses.
insert into public.gl_accounts
  (business_id, code, name, type, normal_balance, is_cash, is_system, sort_order)
select id, '2000', 'Accounts Payable', 'liability', 'credit', false, true, 55
  from public.businesses
on conflict (business_id, code) do nothing;

-- ...and for every new business.
create or replace function public.seed_default_accounts(p_biz uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.gl_accounts (business_id, code, name, type, normal_balance, is_cash, is_system, sort_order) values
    (p_biz, '1000', 'Cash on Hand',        'asset',     'debit',  true,  true, 10),
    (p_biz, '1010', 'Cash in Bank',        'asset',     'debit',  true,  true, 20),
    (p_biz, '1020', 'GCash',               'asset',     'debit',  true,  true, 30),
    (p_biz, '1100', 'Advances to Farmers', 'asset',     'debit',  false, true, 40),
    (p_biz, '1200', 'Copra Inventory',     'asset',     'debit',  false, true, 50),
    (p_biz, '2000', 'Accounts Payable',    'liability', 'credit', false, true, 55),
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

-- ----------------------------------------------------------------------------
create table public.payables (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  payee             text not null,
  category          text,
  amount_centavos   bigint not null check (amount_centavos > 0),
  offset_account_id uuid not null references public.gl_accounts (id),
  incurred_date     date not null default (now() at time zone 'Asia/Manila')::date,
  due_date          date,
  remarks           text,
  status            text not null default 'open' check (status in ('open', 'paid', 'void')),
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);
create index payables_business_idx on public.payables (business_id, status);

create table public.payable_payments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  payable_id      uuid not null references public.payables (id) on delete cascade,
  amount_centavos bigint not null check (amount_centavos > 0),
  cash_account_id uuid not null references public.cash_accounts (id),
  paid_date       date not null default (now() at time zone 'Asia/Manila')::date,
  remarks         text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index payable_payments_payable_idx on public.payable_payments (payable_id);

alter table public.payables         enable row level security;
alter table public.payable_payments enable row level security;
create policy payables_select on public.payables
  for select using (business_id = public.current_business_id());
create policy payable_payments_select on public.payable_payments
  for select using (business_id = public.current_business_id());
grant select, insert, update, delete on public.payables         to authenticated;
grant select, insert, update, delete on public.payable_payments to authenticated;

create or replace view public.v_payable_balances
with (security_invoker = true) as
  select p.id as payable_id, p.business_id, p.payee, p.category,
         p.amount_centavos, p.incurred_date, p.due_date, p.remarks, p.status,
         coalesce(sum(pp.amount_centavos), 0) as paid_centavos,
         p.amount_centavos - coalesce(sum(pp.amount_centavos), 0) as balance_centavos
    from public.payables p
    left join public.payable_payments pp on pp.payable_id = p.id
   group by p.id;
grant select on public.v_payable_balances to authenticated;

-- ----------------------------------------------------------------------------
-- create_payable — book a new obligation: Dr <offset account> / Cr A/P.
-- ----------------------------------------------------------------------------
create or replace function public.create_payable(
  p_payee             text,
  p_amount_centavos   bigint,
  p_incurred_date     date,
  p_due_date          date,
  p_offset_account_id uuid,
  p_category          text,
  p_remarks           text
)
returns public.payables
language plpgsql security definer set search_path = public as $$
declare
  v_biz    uuid := public.current_business_id();
  v_offset uuid;
  v_date   date := coalesce(p_incurred_date, (now() at time zone 'Asia/Manila')::date);
  v_row    public.payables;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can record payables'; end if;
  if coalesce(trim(p_payee), '') = '' then raise exception 'Who is it payable to?'; end if;
  if coalesce(p_amount_centavos, 0) <= 0 then raise exception 'Amount must be positive'; end if;

  if p_offset_account_id is not null then
    select id into v_offset from public.gl_accounts
      where id = p_offset_account_id and business_id = v_biz;
    if v_offset is null then raise exception 'Invalid account'; end if;
  else
    v_offset := public._gl(v_biz, '6900'); -- Other Expenses
  end if;

  insert into public.payables (business_id, payee, category, amount_centavos,
    offset_account_id, incurred_date, due_date, remarks, created_by)
  values (v_biz, trim(p_payee), nullif(trim(coalesce(p_category,'')),''), p_amount_centavos,
    v_offset, v_date, p_due_date, p_remarks, auth.uid())
  returning * into v_row;

  perform public._insert_journal(v_biz, v_date, 'payable', v_row.id,
    'Payable to ' || v_row.payee, true, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('account_id', v_offset, 'debit', p_amount_centavos,
        'memo', coalesce(p_remarks, 'Payable to ' || v_row.payee)),
      jsonb_build_object('code', '2000', 'credit', p_amount_centavos)
    ), false);

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- record_payable_payment — pay a payable: Dr A/P / Cr <cash account>.
-- ----------------------------------------------------------------------------
create or replace function public.record_payable_payment(
  p_payable_id     uuid,
  p_amount_centavos bigint,
  p_cash_account_id uuid,
  p_paid_date      date,
  p_remarks        text
)
returns public.payable_payments
language plpgsql security definer set search_path = public as $$
declare
  v_biz     uuid := public.current_business_id();
  v_date    date := coalesce(p_paid_date, (now() at time zone 'Asia/Manila')::date);
  v_balance bigint;
  v_cash_gl uuid;
  v_pay     public.payables;
  v_row     public.payable_payments;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can pay payables'; end if;
  if coalesce(p_amount_centavos, 0) <= 0 then raise exception 'Amount must be positive'; end if;

  select * into v_pay from public.payables
    where id = p_payable_id and business_id = v_biz and status <> 'void';
  if not found then raise exception 'Payable not found'; end if;

  select p.amount_centavos - coalesce(sum(pp.amount_centavos), 0) into v_balance
    from public.payables p
    left join public.payable_payments pp on pp.payable_id = p.id
    where p.id = p_payable_id group by p.amount_centavos;
  if p_amount_centavos > v_balance then
    raise exception 'Payment (%) exceeds the remaining balance (%)', p_amount_centavos, v_balance;
  end if;

  perform 1 from public.cash_accounts where id = p_cash_account_id and business_id = v_biz;
  if not found then raise exception 'Invalid cash account'; end if;
  v_cash_gl := public._cash_gl(p_cash_account_id);

  insert into public.payable_payments (business_id, payable_id, amount_centavos,
    cash_account_id, paid_date, remarks, created_by)
  values (v_biz, p_payable_id, p_amount_centavos, p_cash_account_id, v_date, p_remarks, auth.uid())
  returning * into v_row;

  perform public._insert_journal(v_biz, v_date, 'payable_payment', v_row.id,
    'Payment — ' || v_pay.payee, true, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('code', '2000', 'debit', p_amount_centavos,
        'memo', coalesce(p_remarks, 'Payment to ' || v_pay.payee)),
      jsonb_build_object('account_id', v_cash_gl, 'credit', p_amount_centavos)
    ), false);

  if v_balance - p_amount_centavos <= 0 then
    update public.payables set status = 'paid' where id = p_payable_id;
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- void_payable — cancel an unpaid payable and reverse its journal.
-- ----------------------------------------------------------------------------
create or replace function public.void_payable(p_payable_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_pay public.payables; v_paid bigint;
begin
  if v_biz is null then raise exception 'No business context'; end if;
  if not public.is_owner() then raise exception 'Only the owner can void payables'; end if;

  select * into v_pay from public.payables where id = p_payable_id and business_id = v_biz and status <> 'void';
  if not found then raise exception 'Payable not found'; end if;
  select coalesce(sum(amount_centavos),0) into v_paid from public.payable_payments where payable_id = p_payable_id;
  if v_paid > 0 then raise exception 'Delete its payments before voiding this payable'; end if;

  -- Reverse the booking: Dr A/P / Cr <offset>.
  perform public._insert_journal(v_biz, (now() at time zone 'Asia/Manila')::date, 'payable_void', v_pay.id,
    'Void payable — ' || v_pay.payee, true, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('code', '2000', 'debit', v_pay.amount_centavos),
      jsonb_build_object('account_id', v_pay.offset_account_id, 'credit', v_pay.amount_centavos)
    ), false);

  update public.payables set status = 'void' where id = p_payable_id;
end;
$$;

grant execute on function public.create_payable(text, bigint, date, date, uuid, text, text) to authenticated;
grant execute on function public.record_payable_payment(uuid, bigint, uuid, date, text) to authenticated;
grant execute on function public.void_payable(uuid) to authenticated;
