# CopraBooks

Copra trading + accounting for a single copra buying station in Mindanao.
Mobile-first PWA for an Owner and a Cashier. Built with Next.js (App Router),
Supabase (Postgres + Auth + RLS), and deployed on Vercel.

- **Currency:** PHP, stored as integer **centavos** (no floats).
- **Weights:** kilograms, `numeric(12,2)`.
- **Timezone:** Asia/Manila.
- **Multi-tenant ready:** every row carries `business_id`; RLS on every table.

## Phase 1 (this build)

- Email/password **auth** with Owner/Cashier **roles** (first account = Owner).
- **Settings:** business details, advance-approval limit, shrinkage threshold, grades.
- **Price board:** Owner sets today's buying price (optionally per grade) and the
  buyer's reference price; cashiers cannot record purchases until today's price
  is set. Full price history is kept.
- **Farmers:** profile, running utang balance, average deduction %, printable
  statement.
- **Purchases:** net-weight calculation, locked-in price, utang deduction,
  **58mm ESC/POS Bluetooth receipt** printing (with browser-print fallback),
  owner **void** (reversal, never delete).
- **Utang ledger:** cash advances (owner approval above a limit), repayments
  (direct cash or via purchase deduction), aging report (0–30/31–60/61–90/90+).
- **Offline:** purchases queue in **IndexedDB** and sync when back online, with a
  clear unsynced badge. Installable PWA.

## Phase 2 (this build)

- **Inventory (single bodega)** with **weighted-average cost**. Purchases stock
  in at cost; sales draw at average cost. `inventory_state` holds the running
  position; `inventory_movements` is an append-only log with balance snapshots.
  Integer-centavos safe (proportional costing, no float drift).
- **Truckload sales** to traders: our vs buyer weights/deductions, price,
  amount received, payment method, trucking/labor/other expenses. Cost of sales
  and profit are computed server-side at average cost. Owner **void** returns
  stock.
- **Shrinkage** at each truckload: `book_kg − loaded_kg` written off at average
  cost, flagged above the configurable threshold (default 3%).
- **Reconciliation**: weight gap and deduction gap per truckload, with a running
  average gap across loads to guide how much manual deduction to apply at buying.
- **Periodic stock count** (owner only) posts a variance adjustment at average
  cost.
- **Dashboard** gains stock on hand (kg, value at cost and at buyer's price),
  this month's gross/net profit, shrinkage % and average deduction gap.
- Sales, stock counts and the movement log (cost/profit detail) are **owner
  only**; stock-on-hand is visible to both roles.

Phases 3–4 (double-entry accounting & auto-posting, cash management & day-close,
financial reports, dashboards, Excel/PDF export) follow.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project values
pnpm dev
```

### Database

Apply the migrations in `supabase/migrations/` (in order) to your Supabase
project, then optionally load sample data from `supabase/seed.sql`.

With the Supabase CLI:

```bash
supabase db reset           # applies migrations + seed.sql locally
# or against a linked project:
supabase db push
```

Or paste each file in order into the Supabase SQL editor:

1. `0001_core.sql` — Phase 1 tables
2. `0002_functions.sql` — Phase 1 RPCs, triggers (incl. `handle_new_user`)
3. `0003_rls.sql` — Row Level Security + grants
4. `0004_views.sql` — Phase 1 reporting views
5. `0005_inventory_sales.sql` — inventory, buyers, sales, stock counts
6. `0006_inventory_functions.sql` — inventory engine, `post_sale`, `void_sale`,
   `post_stock_count`, inventory-aware `post_purchase`/`void_purchase`
7. `0007_inventory_rls.sql` — Phase 2 RLS + grants + inventory backfill
8. `0008_inventory_views.sql` — sale profit, reconciliation, extended dashboard
9. `supabase/seed.sql` — sample data (run as the service role)

The **first user to sign up** becomes the Owner and the business + default
settings are created automatically. The next sign-up becomes a Cashier.

> Note: `seed.sql` creates the business and sample farmers/prices/purchases so
> you can explore the app, but it does **not** create auth users. Sign up for
> the Owner account after seeding — `handle_new_user` attaches it to the seeded
> business.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; for seeding/admin (never exposed) |

## Architecture notes

- **Append-only financials.** `purchases`, `utang_ledger` and `sales` are
  writable only through `SECURITY DEFINER` RPCs (`post_purchase`,
  `void_purchase`, `create_advance`, `approve_advance`, `record_cash_repayment`,
  `post_sale`, `void_sale`, `post_stock_count`). Clients get `SELECT` only. This
  enforces receipt/sale-number sequencing, utang limits, price locking and the
  append-only rule server-side, regardless of the client.
- **Inventory is derived.** `inventory_state` (weighted-average position) and
  `inventory_movements` are maintained by those RPCs; `rebuild_inventory()`
  recomputes them from posted purchases/sales/stock-counts for backfill and
  repair. Costing uses integer-centavos proportional math (`value * kg / qty`),
  so the average cost per kg never drifts.
- **RLS everywhere**, keyed on `current_business_id()`. Views use
  `security_invoker` so policies apply to the querying user.
- **Receipt numbers** are allocated atomically via `document_counters`:
  sequential and never reused; voids keep their number.
- Money math is centavos-only; see `src/lib/money.ts` and `src/lib/weight.ts`.

## Project layout

```
supabase/migrations/   SQL schema, functions, RLS, views
supabase/seed.sql      sample data
src/app/(app)/         authenticated app (dashboard, prices, farmers,
                       purchases, utang, sales, stock, settings)
src/app/login/         auth
src/lib/               supabase clients, money/weight, escpos, offline queue
src/components/        UI primitives, forms, receipt printing
src/types/db.ts        hand-maintained DB types
```
