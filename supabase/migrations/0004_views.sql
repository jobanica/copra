-- ============================================================================
-- CopraBooks — Phase 1 reporting views
--   All views use security_invoker so Row Level Security on the base tables
--   is applied to the querying user (no cross-business leakage).
-- ============================================================================

-- Farmer utang balances (posted rows only) ----------------------------------
create or replace view public.v_farmer_balances
with (security_invoker = true) as
select
  f.id            as farmer_id,
  f.business_id,
  f.name,
  f.barangay,
  f.mobile,
  f.active,
  coalesce(sum(case when l.direction = 'advance'   then l.amount_centavos end), 0)::bigint as advances_centavos,
  coalesce(sum(case when l.direction = 'repayment' then l.amount_centavos end), 0)::bigint as repayments_centavos,
  coalesce(sum(case when l.direction = 'advance'   then l.amount_centavos
                     else -l.amount_centavos end), 0)::bigint as balance_centavos
from public.farmers f
left join public.utang_ledger l
  on l.farmer_id = f.id and l.status = 'posted'
group by f.id, f.business_id, f.name, f.barangay, f.mobile, f.active;

-- Average manual deduction % per farmer (posted purchases) -------------------
create or replace view public.v_farmer_deduction_avg
with (security_invoker = true) as
select
  p.business_id,
  p.farmer_id,
  round(avg(p.deduction_pct), 2) as avg_deduction_pct,
  count(*)                       as purchase_count
from public.purchases p
where p.status = 'posted'
group by p.business_id, p.farmer_id;

-- Utang aging — per-advance outstanding via oldest-first (FIFO) allocation ---
create or replace view public.v_utang_aging_detail
with (security_invoker = true) as
with adv as (
  select
    l.business_id, l.farmer_id, l.id, l.entry_date, l.amount_centavos,
    sum(l.amount_centavos) over (
      partition by l.farmer_id order by l.entry_date, l.created_at
      rows between unbounded preceding and current row
    ) as cum_end,
    sum(l.amount_centavos) over (
      partition by l.farmer_id order by l.entry_date, l.created_at
      rows between unbounded preceding and current row
    ) - l.amount_centavos as cum_start
  from public.utang_ledger l
  where l.status = 'posted' and l.direction = 'advance'
),
repaid as (
  select farmer_id, coalesce(sum(amount_centavos), 0)::bigint as total_repaid
  from public.utang_ledger
  where status = 'posted' and direction = 'repayment'
  group by farmer_id
)
select
  adv.business_id,
  adv.farmer_id,
  adv.id as advance_id,
  adv.entry_date,
  greatest(
    0,
    adv.cum_end - greatest(coalesce(r.total_repaid, 0), adv.cum_start)
  )::bigint as outstanding_centavos,
  ((now() at time zone 'Asia/Manila')::date - adv.entry_date) as age_days
from adv
left join repaid r on r.farmer_id = adv.farmer_id;

create or replace view public.v_utang_aging
with (security_invoker = true) as
select
  d.business_id,
  d.farmer_id,
  sum(case when d.age_days <= 30 then d.outstanding_centavos else 0 end)::bigint as bucket_0_30,
  sum(case when d.age_days between 31 and 60 then d.outstanding_centavos else 0 end)::bigint as bucket_31_60,
  sum(case when d.age_days between 61 and 90 then d.outstanding_centavos else 0 end)::bigint as bucket_61_90,
  sum(case when d.age_days > 90 then d.outstanding_centavos else 0 end)::bigint as bucket_90_plus,
  sum(d.outstanding_centavos)::bigint as total_outstanding
from public.v_utang_aging_detail d
where d.outstanding_centavos > 0
group by d.business_id, d.farmer_id;

-- Today's dashboard aggregates (Asia/Manila) ---------------------------------
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
  )::bigint as total_utang_outstanding_centavos
from public.businesses b;

-- Grant SELECT on the views created above (GRANT ON ALL TABLES earlier in the
-- migration order ran before these views existed).
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
