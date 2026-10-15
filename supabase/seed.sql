-- ============================================================================
-- CopraBooks — sample data (run with the service role; bypasses RLS).
-- Seeds: business + settings, one grade, 30 Mindanao farmers, ~60 days of
-- buying/buyer prices, a batch of cash advances, and ~2 months of purchases
-- (with some utang deductions). Safe to run on an empty database.
--
-- Traders and truckload sales are seeded in Phase 2 (that module is not built
-- yet). Purchases here are inserted directly (not via post_purchase) because
-- the seed runs without an authenticated user.
-- ============================================================================

do $$
declare
  v_biz      uuid;
  v_grade    uuid;
  v_day      date;
  v_today    date := (now() at time zone 'Asia/Manila')::date;
  v_price    bigint;
  v_farmers  uuid[];
  v_fid      uuid;
  v_i        int;
  v_n        int;
  v_gross    numeric(12,2);
  v_tare     numeric(12,2);
  v_dedpct   numeric(5,2);
  v_dedkg    numeric(12,2);
  v_net      numeric(12,2);
  v_amt      bigint;
  v_utang    bigint;
  v_bal      bigint;
  v_rno      bigint;
  v_pid      uuid;
  barangays  text[] := array[
    'Poblacion','San Isidro','Mabuhay','Katipunan','Bagong Silang','Kauswagan',
    'Maligaya','Tagpangi','New Visayas','Dalipuga','Buru-un','Bonbon'];
  fnames     text[] := array[
    'Jose Dela Cruz','Maria Santos','Pedro Reyes','Ana Bautista','Ramon Villanueva',
    'Lourdes Aquino','Roberto Mendoza','Teresita Garcia','Danilo Castro','Nenita Flores',
    'Eduardo Ramos','Corazon Diaz','Alberto Torres','Imelda Gonzales','Ricardo Pascual',
    'Gloria Fernandez','Manuel Aguilar','Rosario Navarro','Felipe Salvador','Divina Roxas',
    'Antonio Lim','Cristina Ocampo','Benjamin Cruz','Erlinda Soriano','Nestor Abad',
    'Perla Ventura','Rodrigo Panganiban','Lydia Español','Arturo Macaraeg','Josefina Sarmiento'];
begin
  -- Business + settings -------------------------------------------------------
  select id into v_biz from public.businesses order by created_at limit 1;
  if v_biz is null then
    insert into public.businesses (name, address)
    values ('Mindanao Copra Trading', 'Iligan City, Lanao del Norte')
    returning id into v_biz;
  end if;

  insert into public.business_settings (business_id, receipt_header)
  values (v_biz, jsonb_build_object(
    'business_name', 'Mindanao Copra Trading',
    'address', 'Iligan City, Lanao del Norte',
    'footer', 'Salamat po! — CopraBooks'))
  on conflict (business_id) do nothing;

  -- One ungraded grade (standard dried copra) --------------------------------
  insert into public.grades (business_id, name) values (v_biz, 'Standard')
  on conflict (business_id, name) do nothing;
  select id into v_grade from public.grades where business_id = v_biz and name = 'Standard';

  -- Farmers -------------------------------------------------------------------
  if (select count(*) from public.farmers where business_id = v_biz) = 0 then
    for v_i in 1..array_length(fnames, 1) loop
      insert into public.farmers (business_id, name, barangay, mobile)
      values (
        v_biz, fnames[v_i],
        barangays[1 + ((v_i - 1) % array_length(barangays, 1))],
        '09' || lpad((170000000 + v_i * 131)::text, 9, '0'))
      returning id into v_fid;
    end loop;
  end if;

  select array_agg(id order by created_at) into v_farmers
    from public.farmers where business_id = v_biz;

  -- Prices for the last 60 days ----------------------------------------------
  v_day := v_today - 60;
  while v_day <= v_today loop
    -- Our buying price drifts ₱42.00–₱48.00/kg; buyer pays ~₱3.50/kg more.
    v_price := 4200 + ((abs(hashtext(v_day::text)) % 600));
    insert into public.buying_prices (business_id, effective_date, grade_id, price_per_kg_centavos)
    values (v_biz, v_day, v_grade, v_price)
    on conflict do nothing;
    insert into public.buyer_reference_prices (business_id, effective_date, price_per_kg_centavos)
    values (v_biz, v_day, v_price + 350)
    on conflict (business_id, effective_date) do nothing;
    v_day := v_day + 1;
  end loop;

  -- Cash advances to ~10 farmers ---------------------------------------------
  if (select count(*) from public.utang_ledger where business_id = v_biz) = 0 then
    for v_i in 1..10 loop
      insert into public.utang_ledger (
        business_id, farmer_id, entry_date, direction, amount_centavos,
        source_type, status, remarks)
      values (
        v_biz, v_farmers[v_i], v_today - (40 + v_i),
        'advance', (150000 + (abs(hashtext(v_i::text)) % 350000))::bigint,
        'cash_advance', 'posted', 'Seed advance');
    end loop;
  end if;

  -- Purchases over the last ~58 days -----------------------------------------
  if (select count(*) from public.purchases where business_id = v_biz) = 0 then
    v_day := v_today - 58;
    while v_day <= v_today loop
      select price_per_kg_centavos into v_price
        from public.buying_prices
        where business_id = v_biz and effective_date = v_day and grade_id = v_grade;

      -- 1–3 purchases per day
      v_n := 1 + (abs(hashtext('n' || v_day::text)) % 3);
      for v_i in 1..v_n loop
        v_fid  := v_farmers[1 + (abs(hashtext(v_day::text || v_i::text)) % array_length(v_farmers, 1))];
        v_gross := 100 + (abs(hashtext('g' || v_day::text || v_i::text)) % 300);
        v_tare  := round(v_gross * 0.01, 2);
        v_dedpct := 3 + (abs(hashtext('d' || v_day::text || v_i::text)) % 6);
        v_dedkg := round((v_gross - v_tare) * v_dedpct / 100.0, 2);
        v_net   := round(v_gross - v_tare - v_dedkg, 2);
        v_amt   := round(v_net * v_price)::bigint;

        -- Occasionally deduct some utang (if the farmer has a balance).
        v_bal := public.farmer_balance_centavos(v_fid);
        v_utang := 0;
        if v_bal > 0 and (abs(hashtext('u' || v_day::text || v_i::text)) % 3) = 0 then
          v_utang := least(v_bal, least(v_amt, 50000::bigint));
        end if;

        v_rno := public.allocate_document_number(v_biz, 'purchase_receipt');

        insert into public.purchases (
          business_id, receipt_no, farmer_id, grade_id, purchased_at, sack_count,
          gross_kg, tare_kg, deduction_kg, deduction_pct, net_kg,
          price_per_kg_centavos, gross_amount_centavos, utang_deducted_centavos,
          cash_paid_centavos, status)
        values (
          v_biz, v_rno, v_fid, v_grade,
          (v_day::timestamp + time '09:00') at time zone 'Asia/Manila',
          greatest(1, round(v_gross / 45)::int),
          v_gross, v_tare, v_dedkg, v_dedpct, v_net,
          v_price, v_amt, v_utang, v_amt - v_utang, 'posted')
        returning id into v_pid;

        if v_utang > 0 then
          insert into public.utang_ledger (
            business_id, farmer_id, entry_date, direction, amount_centavos,
            source_type, source_id, status)
          values (
            v_biz, v_fid, v_day, 'repayment', v_utang, 'purchase_deduction', v_pid, 'posted');
        end if;
      end loop;

      v_day := v_day + 1;
    end loop;
  end if;
end $$;

-- ============================================================================
-- Phase 2 sample data: traders (buyers) and truckload sales.
-- Inventory is recomputed at the end via rebuild_inventory().
-- ============================================================================
do $$
declare
  v_biz     uuid;
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_b1      uuid;
  v_b2      uuid;
  v_loaded  numeric(12,2);
  v_bgross  numeric(12,2);
  v_bnet    numeric(12,2);
  v_price   bigint := 5400;   -- buyer pays ~₱54.00/kg (we buy at ~₱45)
  v_sno     bigint;
begin
  select id into v_biz from public.businesses order by created_at limit 1;

  if (select count(*) from public.buyers where business_id = v_biz) = 0 then
    insert into public.buyers (business_id, name, contact)
      values (v_biz, 'Davao Copra Traders Inc.', 'Mr. Tan 0917-555-0101')
      returning id into v_b1;
    insert into public.buyers (business_id, name, contact)
      values (v_biz, 'Zamboanga Oil Millers', 'Ms. Lim 0918-555-0202')
      returning id into v_b2;
  else
    select id into v_b1 from public.buyers where business_id = v_biz order by created_at limit 1;
    select id into v_b2 from public.buyers where business_id = v_biz order by created_at desc limit 1;
  end if;

  if (select count(*) from public.sales where business_id = v_biz) = 0 then
    -- Truckload 1 (~20 days ago): a little shrinkage (book > loaded).
    v_loaded := 4000.00;
    v_bgross := 3980.00;                    -- buyer weighs slightly less (transit)
    v_bnet   := round(v_bgross * 0.93, 2);  -- buyer applies 7% deduction
    v_sno := public.allocate_document_number(v_biz, 'sale');
    insert into public.sales (
      business_id, sale_no, buyer_id, sale_date, plate_no, driver,
      our_loaded_kg, our_avg_deduction_pct, buyer_gross_kg, buyer_deduction_pct, buyer_net_kg,
      price_per_kg_centavos, amount_received_centavos, payment_method,
      trucking_centavos, labor_centavos, other_expenses_centavos, book_kg, remarks, status)
    values (
      v_biz, v_sno, v_b1, v_today - 20, 'GAB-1234', 'Juan Cruz',
      v_loaded, 5.00, v_bgross, 7.00, v_bnet,
      v_price, round(v_bnet * v_price)::bigint, 'bank',
      800000, 150000, 50000, 4080.00, 'Seed truckload 1', 'posted');

    -- Truckload 2 (~5 days ago): no shrinkage recorded (book = loaded).
    v_loaded := 4500.00;
    v_bgross := 4490.00;
    v_bnet   := round(v_bgross * 0.93, 2);
    v_sno := public.allocate_document_number(v_biz, 'sale');
    insert into public.sales (
      business_id, sale_no, buyer_id, sale_date, plate_no, driver,
      our_loaded_kg, our_avg_deduction_pct, buyer_gross_kg, buyer_deduction_pct, buyer_net_kg,
      price_per_kg_centavos, amount_received_centavos, payment_method,
      trucking_centavos, labor_centavos, other_expenses_centavos, book_kg, remarks, status)
    values (
      v_biz, v_sno, v_b2, v_today - 5, 'LMN-5678', 'Pedro Santos',
      v_loaded, 5.00, v_bgross, 6.50, v_bnet,
      v_price, round(v_bnet * v_price)::bigint, 'gcash',
      900000, 150000, 0, 4500.00, 'Seed truckload 2', 'posted');
  end if;

  perform public.rebuild_inventory(v_biz);
end $$;
