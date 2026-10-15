-- ============================================================================
-- CopraBooks — Phase 2 reporting views: sale profit, truckload reconciliation
-- (with running weight/deduction gaps), and an extended dashboard.
-- security_invoker so RLS applies (sales are owner-only).
-- ============================================================================

-- Profit per truckload -------------------------------------------------------
create or replace view public.v_sale_profit
with (security_invoker = true) as
select
  s.id,
  s.business_id,
  s.sale_no,
  s.sale_date,
  s.buyer_id,
  s.amount_received_centavos                                   as revenue_centavos,
  s.cost_of_sales_centavos                                     as cogs_centavos,
  (s.trucking_centavos + s.labor_centavos + s.other_expenses_centavos) as expenses_centavos,
  s.shrinkage_value_centavos,
  (s.amount_received_centavos - s.cost_of_sales_centavos)      as gross_profit_centavos,
  (s.amount_received_centavos - s.cost_of_sales_centavos
     - s.trucking_centavos - s.labor_centavos - s.other_expenses_centavos) as net_profit_centavos
from public.sales s
where s.status = 'posted';

-- Reconciliation: our weight vs buyer weight, our vs buyer deduction, with a
-- running average gap across truckloads (oldest to newest).
create or replace view public.v_sale_reconciliation
with (security_invoker = true) as
select
  s.id,
  s.business_id,
  s.sale_no,
  s.sale_date,
  s.buyer_id,
  s.our_loaded_kg,
  s.buyer_gross_kg,
  s.our_avg_deduction_pct,
  s.buyer_deduction_pct,
  round(s.our_loaded_kg - coalesce(s.buyer_gross_kg, s.our_loaded_kg), 2) as weight_gap_kg,
  case when s.our_loaded_kg > 0
       then round((s.our_loaded_kg - coalesce(s.buyer_gross_kg, s.our_loaded_kg)) / s.our_loaded_kg * 100, 2)
       else 0 end as weight_gap_pct,
  round(coalesce(s.buyer_deduction_pct, 0) - s.our_avg_deduction_pct, 2) as deduction_gap_pct,
  round(avg(coalesce(s.buyer_deduction_pct, 0) - s.our_avg_deduction_pct)
          over (partition by s.business_id order by s.sale_date, s.created_at), 2) as running_avg_deduction_gap_pct,
  round(avg(case when s.our_loaded_kg > 0
                 then (s.our_loaded_kg - coalesce(s.buyer_gross_kg, s.our_loaded_kg)) / s.our_loaded_kg * 100
                 else 0 end)
          over (partition by s.business_id order by s.sale_date, s.created_at), 2) as running_avg_weight_gap_pct
from public.sales s
where s.status = 'posted';

-- Extended "today / this month" dashboard -----------------------------------
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
  )::bigint as total_utang_outstanding_centavos,
  -- Phase 2 additions
  coalesce((select qty_on_hand_kg from public.inventory_state i where i.business_id = b.id), 0) as stock_on_hand_kg,
  coalesce((select total_value_centavos from public.inventory_state i where i.business_id = b.id), 0)::bigint as stock_value_centavos,
  (coalesce((select qty_on_hand_kg from public.inventory_state i where i.business_id = b.id), 0)
     * coalesce((select price_per_kg_centavos from public.buyer_reference_prices brp
          where brp.business_id = b.id
          order by brp.effective_date desc limit 1), 0))::bigint as stock_value_at_buyer_centavos,
  (select coalesce(sum(sp.net_profit_centavos), 0) from public.v_sale_profit sp
     where sp.business_id = b.id
       and date_trunc('month', sp.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  )::bigint as month_net_profit_centavos,
  (select coalesce(sum(sp.gross_profit_centavos), 0) from public.v_sale_profit sp
     where sp.business_id = b.id
       and date_trunc('month', sp.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  )::bigint as month_gross_profit_centavos,
  (select round(avg(r.running_avg_deduction_gap_pct), 2) from public.v_sale_reconciliation r
     where r.business_id = b.id
  ) as avg_deduction_gap_pct,
  (select case when sum(s.book_kg) > 0
               then round(sum(s.shrinkage_kg) / sum(s.book_kg) * 100, 2) else 0 end
     from public.sales s
     where s.business_id = b.id and s.status = 'posted'
       and date_trunc('month', s.sale_date) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)
  ) as month_shrinkage_pct
from public.businesses b;

-- Grant SELECT on the Phase 2 views (and re-affirm all), since these views are
-- created after the GRANT ON ALL TABLES in 0007.
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
