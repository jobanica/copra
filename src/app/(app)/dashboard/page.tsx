import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { Card } from "@/components/ui";
import { LineChart, type ChartPoint } from "@/components/LineChart";
import { DashboardFilter } from "@/components/DashboardFilter";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDate, manilaToday } from "@/lib/format";
import type {
  DashboardTodayView,
  BuyingPrice,
  BuyerReferencePrice,
  CashBalanceRow,
} from "@/types/db";

const CASH_ICON: Record<string, string> = {
  cash_on_hand: "💵",
  bank: "🏦",
  gcash: "📱",
};

export const dynamic = "force-dynamic";

const TZ = "Asia/Manila";
const mdate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const minusDays = (ymd: string, days: number) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000,
  );

type Tone = "green" | "amber" | "blue" | "violet" | "rose";
const TONES: Record<Tone, string> = {
  green: "bg-brand-50 text-brand-700",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
  rose: "bg-rose-50 text-rose-700",
};

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
}) {
  return (
    <div className={`rounded-2xl p-4 ${TONES[tone]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-xs opacity-70">{hint}</div>}
    </div>
  );
}

interface RangePurchase {
  id: string;
  receipt_no: number;
  purchased_at: string;
  net_kg: number;
  gross_amount_centavos: number;
  cash_paid_centavos: number;
  farmer_id: string;
  status: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSessionProfile();
  const isOwner = session?.profile.role === "owner";
  const firstName = session?.profile.full_name?.split(" ")[0];
  const supabase = await createClient();
  const today = manilaToday();

  // Resolve the selected date range (defaults to the last 14 days).
  const sp = await searchParams;
  let from = sp.from && YMD.test(sp.from) ? sp.from : minusDays(today, 13);
  let to = sp.to && YMD.test(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  const singleDay = from === to;
  const rangeDays = Math.min(366, daysBetween(from, to) + 1);

  // Manila day boundaries expressed as fixed-offset timestamps (UTC+8).
  const startIso = `${from}T00:00:00+08:00`;
  const endIso = `${to}T23:59:59.999+08:00`;

  const [
    { data: dash },
    { data: price },
    { data: buyerPrice },
    { data: cashBal },
    { data: expected },
    { data: purchases },
    { data: farmers },
    { data: expenseRows },
    { data: payableRows },
  ] = await Promise.all([
    supabase.from("v_dashboard_today").select("*").maybeSingle(),
    supabase
      .from("buying_prices")
      .select("*")
      .eq("effective_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("buyer_reference_prices").select("*").eq("effective_date", today).maybeSingle(),
    supabase.rpc("cash_balances"),
    supabase.rpc("cash_day_expected", { p_business_date: today }),
    supabase
      .from("purchases")
      .select(
        "id,receipt_no,purchased_at,net_kg,gross_amount_centavos,cash_paid_centavos,farmer_id,status",
      )
      .eq("status", "posted")
      .gte("purchased_at", startIso)
      .lte("purchased_at", endIso)
      .order("purchased_at", { ascending: false })
      .limit(3000),
    supabase.from("farmers").select("id,name"),
    supabase
      .from("expenses")
      .select("amount_centavos")
      .eq("status", "posted")
      .gte("expense_date", from)
      .lte("expense_date", to),
    supabase.from("v_payable_balances").select("balance_centavos,status").eq("status", "open"),
  ]);

  const d = (dash ?? null) as DashboardTodayView | null;
  const p = (price ?? null) as BuyingPrice | null;
  const bp = (buyerPrice ?? null) as BuyerReferencePrice | null;
  const marginPerKg = p && bp ? bp.price_per_kg_centavos - p.price_per_kg_centavos : null;
  const rows = (purchases ?? []) as RangePurchase[];
  const farmerName = new Map(
    ((farmers ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]),
  );
  const cashRows = (cashBal ?? []) as CashBalanceRow[];
  const cashOnHand =
    cashRows.find((c) => c.type === "cash_on_hand")?.balance_centavos ?? 0;
  const expectedDrawer = (expected as number | null) ?? cashOnHand;

  // Working capital = all cash (cash on hand + bank + gcash) + utang
  // receivable + stock on hand valued at cost.
  const totalCash = cashRows.reduce((s, c) => s + Number(c.balance_centavos), 0);
  const utangOut = d?.total_utang_outstanding_centavos ?? 0;
  const stockValue = d?.stock_value_centavos ?? 0;
  const stockKg = d?.stock_on_hand_kg ?? 0;
  const totalPayable = ((payableRows ?? []) as { balance_centavos: number }[]).reduce(
    (s, r) => s + Number(r.balance_centavos),
    0,
  );
  const assetsTotal = totalCash + utangOut + stockValue;
  const workingCapital = assetsTotal - totalPayable;
  const totalExpenses = ((expenseRows ?? []) as { amount_centavos: number }[]).reduce(
    (sum, e) => sum + Number(e.amount_centavos),
    0,
  );

  // Range totals.
  let rangeNetKg = 0;
  let rangeCashOut = 0;
  const byDay = new Map<string, number>();
  const topMap = new Map<string, number>();
  for (const r of rows) {
    const kg = Number(r.net_kg);
    rangeNetKg += kg;
    rangeCashOut += Number(r.cash_paid_centavos);
    const k = mdate(r.purchased_at);
    byDay.set(k, (byDay.get(k) ?? 0) + kg);
    topMap.set(r.farmer_id, (topMap.get(r.farmer_id) ?? 0) + kg);
  }

  // Daily net-kg series across the selected range.
  const series: ChartPoint[] = [];
  const base = new Date(to + "T00:00:00Z");
  for (let i = rangeDays - 1; i >= 0; i--) {
    const dd = new Date(base);
    dd.setUTCDate(base.getUTCDate() - i);
    const key = dd.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(dd);
    series.push({ label, value: Math.round((byDay.get(key) ?? 0) * 100) / 100 });
  }

  const topFarmers = [...topMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = rows.slice(0, 6);

  const rangeLabel = singleDay
    ? from === today
      ? "Today"
      : formatDate(from + "T00:00:00+08:00")
    : `${formatDate(from + "T00:00:00+08:00")} – ${formatDate(to + "T00:00:00+08:00")}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back{firstName ? `, ${firstName}` : ""} 👋
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Here&apos;s what&apos;s happening at the buying station.
          </p>
        </div>
        <DashboardFilter from={from} to={to} today={today} />
      </div>

      {isOwner && !p && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-800">Today&apos;s buying price is not set.</div>
          <p className="mt-1 text-sm text-amber-700">
            Cashiers cannot record purchases until you set today&apos;s price.
          </p>
          <Link href="/prices" className="btn-primary mt-3 inline-flex">
            Set today&apos;s price
          </Link>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi tone="blue" label="Cash on hand" value={formatPeso(cashOnHand)} hint="in drawer now" />
        <Kpi tone="green" label="Kg bought" value={formatKg(rangeNetKg)} hint={`${rows.length} purchases · ${rangeLabel}`} />
        <Kpi tone="amber" label="Cash paid out" value={formatPeso(rangeCashOut)} hint={rangeLabel} />
        <Kpi tone="rose" label="Total expenses" value={formatPeso(totalExpenses)} hint={rangeLabel} />
        {isOwner ? (
          <>
            <Kpi tone="blue" label="Stock on hand" value={formatKg(d?.stock_on_hand_kg ?? 0)} hint={`Cost ${formatPeso(d?.stock_value_centavos ?? 0)}`} />
            <Kpi tone="violet" label="Gross profit (month)" value={formatPeso(d?.month_gross_profit_centavos ?? 0)} hint={marginPerKg !== null ? `Margin ${formatPeso(marginPerKg)}/kg` : undefined} />
            <Kpi tone="amber" label="Total utang out" value={formatPeso(d?.total_utang_outstanding_centavos ?? 0)} />
            <Kpi tone="rose" label="Total payable" value={formatPeso(totalPayable)} hint="we owe" />
          </>
        ) : (
          <>
            <Kpi tone="violet" label="Expected in drawer" value={formatPeso(expectedDrawer)} />
            <Kpi tone="green" label="Buying price / kg" value={p ? formatPeso(p.price_per_kg_centavos) : "—"} />
          </>
        )}
      </div>

      {/* Working capital (owner) */}
      {isOwner && (
        <Card className="bg-gradient-to-br from-brand-50 to-white">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Total working capital</h2>
              <p className="text-xs text-gray-500">Cash + bank + GCash + utang + stock − payable</p>
            </div>
            <span className="text-2xl font-bold tabular-nums text-brand-700 sm:text-3xl">
              {formatPeso(workingCapital)}
            </span>
          </div>
          <div className="divide-y divide-gray-100 text-sm">
            {cashRows.map((c) => (
              <div key={c.cash_account_id} className="flex items-center justify-between py-1.5">
                <span className="text-gray-500">
                  {CASH_ICON[c.type] ?? "💵"} {c.name}
                </span>
                <span className="font-medium tabular-nums">{formatPeso(c.balance_centavos)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-1.5">
              <span className="text-gray-500">🧾 Utang receivable</span>
              <span className="font-medium tabular-nums">{formatPeso(utangOut)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-gray-500">📦 Stock at cost · {formatKg(stockKg)}</span>
              <span className="font-medium tabular-nums">{formatPeso(stockValue)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="font-medium">Assets subtotal</span>
              <span className="font-medium tabular-nums">{formatPeso(assetsTotal)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-gray-500">💳 Less: Payable</span>
              <span className="font-medium tabular-nums text-red-600">
                −{formatPeso(totalPayable, false)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 text-base font-bold">
              <span>Net working capital</span>
              <span className="tabular-nums text-brand-700">{formatPeso(workingCapital)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Summary chart */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Kg bought — {rangeLabel}</h2>
          <Link href="/purchases/new" className="btn-primary px-4 py-2 text-sm">
            ⚖️ Buy
          </Link>
        </div>
        <LineChart points={series} valueFormat={(n) => formatKg(n)} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Recent purchases */}
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent purchases</h2>
            <Link href="/purchases" className="text-sm font-medium text-brand-700">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-400">No purchases in this period.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recent.map((r) => (
                <Link
                  key={r.id}
                  href={`/purchases/${r.id}`}
                  className="flex items-center justify-between py-2.5 active:bg-gray-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-base">
                      👨‍🌾
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {farmerName.get(r.farmer_id) ?? "Farmer"}
                      </div>
                      <div className="text-xs text-gray-400">
                        #{r.receipt_no} · {formatDate(r.purchased_at)} · {formatKg(r.net_kg)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold">
                    {formatPeso(r.gross_amount_centavos)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Top farmers in range */}
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Top farmers — {rangeLabel}</h2>
          {topFarmers.length === 0 ? (
            <p className="text-sm text-gray-400">No activity in this period.</p>
          ) : (
            <div className="space-y-2">
              {topFarmers.map(([fid, kg], i) => (
                <Link
                  key={fid}
                  href={`/farmers/${fid}`}
                  className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">{farmerName.get(fid) ?? "Farmer"}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{formatKg(kg)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
