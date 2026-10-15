-- ============================================================================
-- CopraBooks — Phase 3 accounting views: account balances, trial balance,
-- general ledger (with running balance), cash account balances, and an
-- income-statement / balance-sheet roll-up. security_invoker (owner-gated by
-- the journal RLS policies).
-- ============================================================================

-- Per-account totals and signed balance (normal-side positive).
create or replace view public.v_account_balances
with (security_invoker = true) as
select
  a.id as account_id,
  a.business_id,
  a.code,
  a.name,
  a.type,
  a.normal_balance,
  a.sort_order,
  coalesce(sum(jl.debit_centavos), 0)::bigint  as debit_total_centavos,
  coalesce(sum(jl.credit_centavos), 0)::bigint as credit_total_centavos,
  (coalesce(sum(jl.debit_centavos), 0) - coalesce(sum(jl.credit_centavos), 0))::bigint as debit_minus_credit_centavos,
  (case when a.normal_balance = 'debit'
        then coalesce(sum(jl.debit_centavos), 0) - coalesce(sum(jl.credit_centavos), 0)
        else coalesce(sum(jl.credit_centavos), 0) - coalesce(sum(jl.debit_centavos), 0) end)::bigint as balance_centavos
from public.gl_accounts a
left join public.journal_lines jl on jl.account_id = a.id
group by a.id, a.business_id, a.code, a.name, a.type, a.normal_balance, a.sort_order;

-- Trial balance: debit/credit balance columns (should sum equal).
create or replace view public.v_trial_balance
with (security_invoker = true) as
select
  b.account_id,
  b.business_id,
  b.code,
  b.name,
  b.type,
  b.sort_order,
  greatest(b.debit_minus_credit_centavos, 0)::bigint  as debit_balance_centavos,
  greatest(-b.debit_minus_credit_centavos, 0)::bigint as credit_balance_centavos
from public.v_account_balances b
where b.debit_minus_credit_centavos <> 0;

-- General ledger: each line with the entry context and a running balance.
create or replace view public.v_general_ledger
with (security_invoker = true) as
select
  jl.id as line_id,
  je.business_id,
  jl.account_id,
  a.code,
  a.name,
  je.entry_no,
  je.entry_date,
  je.source_type,
  je.memo,
  je.status,
  jl.debit_centavos,
  jl.credit_centavos,
  sum(jl.debit_centavos - jl.credit_centavos) over (
    partition by jl.account_id order by je.entry_date, je.entry_no
    rows between unbounded preceding and current row
  )::bigint as running_debit_minus_credit_centavos
from public.journal_lines jl
join public.journal_entries je on je.id = jl.entry_id
join public.gl_accounts a on a.id = jl.account_id;

-- Cash account balances (for the Cash page).
create or replace view public.v_cash_account_balances
with (security_invoker = true) as
select
  ca.id as cash_account_id,
  ca.business_id,
  ca.name,
  ca.type,
  coalesce(bal.debit_minus_credit_centavos, 0)::bigint as balance_centavos
from public.cash_accounts ca
left join public.v_account_balances bal on bal.account_id = ca.gl_account_id;

-- Income statement / balance sheet roll-up by account type.
create or replace view public.v_pl_summary
with (security_invoker = true) as
select
  business_id,
  type,
  sum(balance_centavos)::bigint as balance_centavos
from public.v_account_balances
group by business_id, type;

-- Grant SELECT on the views (created after the GRANT ON ALL TABLES in 0011).
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
