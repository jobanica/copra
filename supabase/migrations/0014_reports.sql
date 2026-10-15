-- ============================================================================
-- CopraBooks — Phase 4 financial report functions.
--   Parameterized (date range / as-of) reports built on the journal. These are
--   SECURITY INVOKER (the default), so RLS applies: the ledger-based reports
--   return rows only for the owner, exactly like the underlying tables.
-- ============================================================================

-- Account activity within an (optional) date range; normal-side balance.
create or replace function public.report_account_activity(p_from date, p_to date)
returns table (
  account_id uuid, code text, name text, type text, normal_balance text,
  sort_order int, debit_centavos bigint, credit_centavos bigint, balance_centavos bigint)
language sql stable
set search_path = public
as $$
  select a.id, a.code, a.name, a.type, a.normal_balance, a.sort_order,
    coalesce(sum(jl.debit_centavos), 0)::bigint,
    coalesce(sum(jl.credit_centavos), 0)::bigint,
    (case when a.normal_balance = 'debit'
          then coalesce(sum(jl.debit_centavos), 0) - coalesce(sum(jl.credit_centavos), 0)
          else coalesce(sum(jl.credit_centavos), 0) - coalesce(sum(jl.debit_centavos), 0) end)::bigint
  from public.gl_accounts a
  join public.journal_lines jl on jl.account_id = a.id
  join public.journal_entries je on je.id = jl.entry_id
  where a.business_id = public.current_business_id()
    and (p_from is null or je.entry_date >= p_from)
    and (p_to is null or je.entry_date <= p_to)
  group by a.id, a.code, a.name, a.type, a.normal_balance, a.sort_order
  order by a.sort_order;
$$;

-- General ledger lines within an (optional) range and (optional) account.
create or replace function public.report_general_ledger(p_from date, p_to date, p_account_id uuid)
returns table (
  entry_no bigint, entry_date date, code text, name text, source_type text,
  memo text, status text, debit_centavos bigint, credit_centavos bigint,
  running_centavos bigint)
language sql stable
set search_path = public
as $$
  select je.entry_no, je.entry_date, a.code, a.name, je.source_type, je.memo, je.status,
    jl.debit_centavos, jl.credit_centavos,
    sum(jl.debit_centavos - jl.credit_centavos) over (
      partition by jl.account_id order by je.entry_date, je.entry_no
      rows between unbounded preceding and current row)::bigint
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.entry_id
  join public.gl_accounts a on a.id = jl.account_id
  where a.business_id = public.current_business_id()
    and (p_account_id is null or jl.account_id = p_account_id)
    and (p_from is null or je.entry_date >= p_from)
    and (p_to is null or je.entry_date <= p_to)
  order by a.code, je.entry_date, je.entry_no;
$$;

-- Cash book: movements on one cash account within a range.
create or replace function public.report_cash_book(p_from date, p_to date, p_cash_account_id uuid)
returns table (
  entry_no bigint, entry_date date, memo text, source_type text,
  cash_in_centavos bigint, cash_out_centavos bigint, running_centavos bigint)
language sql stable
set search_path = public
as $$
  select je.entry_no, je.entry_date, je.memo, je.source_type,
    jl.debit_centavos, jl.credit_centavos,
    sum(jl.debit_centavos - jl.credit_centavos) over (
      order by je.entry_date, je.entry_no
      rows between unbounded preceding and current row)::bigint
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.entry_id
  join public.cash_accounts ca on ca.gl_account_id = jl.account_id
  where ca.business_id = public.current_business_id()
    and ca.id = p_cash_account_id
    and (p_from is null or je.entry_date >= p_from)
    and (p_to is null or je.entry_date <= p_to)
  order by je.entry_date, je.entry_no;
$$;

-- Expense report within a range.
create or replace function public.report_expenses(p_from date, p_to date)
returns table (
  expense_date date, category text, paid_from text,
  amount_centavos bigint, remarks text)
language sql stable
set search_path = public
as $$
  select e.expense_date, g.name, ca.name, e.amount_centavos, e.remarks
  from public.expenses e
  join public.gl_accounts g on g.id = e.expense_account_id
  join public.cash_accounts ca on ca.id = e.cash_account_id
  where e.business_id = public.current_business_id()
    and e.status = 'posted'
    and (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date <= p_to)
  order by e.expense_date, g.name;
$$;

-- Monthly summary for a year: kg bought, buying cash, revenue, COGS, gross
-- profit, operating expenses (general + truckload + shrinkage) and net profit.
create or replace function public.report_monthly_summary(p_year int)
returns table (
  month int, kg_bought numeric, buy_cash_centavos bigint, revenue_centavos bigint,
  cogs_centavos bigint, gross_profit_centavos bigint, opex_centavos bigint,
  net_profit_centavos bigint)
language sql stable
set search_path = public
as $$
  with biz as (select public.current_business_id() as id),
  months as (select generate_series(1, 12) as m),
  p as (
    select extract(month from (purchased_at at time zone 'Asia/Manila')::date)::int as m,
           sum(net_kg) as kg, sum(cash_paid_centavos) as cash
    from public.purchases, biz
    where purchases.business_id = biz.id and status = 'posted'
      and extract(year from (purchased_at at time zone 'Asia/Manila')::date) = p_year
    group by 1),
  s as (
    select extract(month from sale_date)::int as m,
           sum(amount_received_centavos) as rev, sum(cost_of_sales_centavos) as cogs,
           sum(trucking_centavos + labor_centavos + other_expenses_centavos) as texp,
           sum(shrinkage_value_centavos) as shr
    from public.sales, biz
    where sales.business_id = biz.id and status = 'posted'
      and extract(year from sale_date) = p_year
    group by 1),
  e as (
    select extract(month from expense_date)::int as m, sum(amount_centavos) as exp
    from public.expenses, biz
    where expenses.business_id = biz.id and status = 'posted'
      and extract(year from expense_date) = p_year
    group by 1)
  select months.m,
    coalesce(p.kg, 0),
    coalesce(p.cash, 0)::bigint,
    coalesce(s.rev, 0)::bigint,
    coalesce(s.cogs, 0)::bigint,
    (coalesce(s.rev, 0) - coalesce(s.cogs, 0))::bigint,
    (coalesce(e.exp, 0) + coalesce(s.texp, 0) + coalesce(s.shr, 0))::bigint,
    (coalesce(s.rev, 0) - coalesce(s.cogs, 0)
      - (coalesce(e.exp, 0) + coalesce(s.texp, 0) + coalesce(s.shr, 0)))::bigint
  from months
  left join p on p.m = months.m
  left join s on s.m = months.m
  left join e on e.m = months.m
  order by months.m;
$$;

grant execute on function public.report_account_activity(date, date) to authenticated;
grant execute on function public.report_general_ledger(date, date, uuid) to authenticated;
grant execute on function public.report_cash_book(date, date, uuid) to authenticated;
grant execute on function public.report_expenses(date, date) to authenticated;
grant execute on function public.report_monthly_summary(int) to authenticated;
