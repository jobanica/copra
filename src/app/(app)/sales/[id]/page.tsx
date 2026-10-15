import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { voidSale } from "../actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDate } from "@/lib/format";
import type { Sale, Buyer, SaleReconciliationView } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: saleData } = await supabase
    .from("sales")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!saleData) notFound();
  const s = saleData as Sale;

  const [{ data: buyer }, { data: recon }] = await Promise.all([
    s.buyer_id
      ? supabase.from("buyers").select("*").eq("id", s.buyer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("v_sale_reconciliation").select("*").eq("id", id).maybeSingle(),
  ]);
  const b = buyer as Buyer | null;
  const r = recon as SaleReconciliationView | null;

  const expenses =
    s.trucking_centavos + s.labor_centavos + s.other_expenses_centavos;
  const grossProfit = s.amount_received_centavos - s.cost_of_sales_centavos;
  const netProfit = grossProfit - expenses;

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Sale #${s.sale_no}`}
        subtitle={`${formatDate(s.sale_date)}${b ? " · " + b.name : ""}`}
      />

      {s.status === "voided" && (
        <Card className="border-red-300 bg-red-50">
          <Badge tone="red">Voided</Badge>
          <p className="mt-1 text-sm text-red-700">{s.void_reason}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-semibold">Load</h2>
        <Row label="Plate / driver" value={[s.plate_no, s.driver].filter(Boolean).join(" · ") || "—"} />
        <Row label="Our loaded kg" value={formatKg(s.our_loaded_kg)} />
        <Row label="Book kg drawn" value={formatKg(s.book_kg)} />
        <Row
          label="Shrinkage"
          value={`${formatKg(s.shrinkage_kg)}${s.shrinkage_flag ? "  ⚠ above threshold" : ""}`}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Reconciliation</h2>
        <Row label="Our loaded" value={formatKg(s.our_loaded_kg)} />
        <Row label="Buyer gross" value={s.buyer_gross_kg != null ? formatKg(s.buyer_gross_kg) : "—"} />
        {r && <Row label="Weight gap" value={`${formatKg(r.weight_gap_kg)} (${r.weight_gap_pct}%)`} />}
        <div className="border-t border-gray-100" />
        <Row label="Our deduction" value={`${s.our_avg_deduction_pct}%`} />
        <Row label="Buyer deduction" value={s.buyer_deduction_pct != null ? `${s.buyer_deduction_pct}%` : "—"} />
        {r && <Row label="Deduction gap" value={`${r.deduction_gap_pct}%`} />}
        {r && (
          <Row
            label="Running avg deduction gap"
            value={`${r.running_avg_deduction_gap_pct}%`}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Profit</h2>
        <Row label="Amount received" value={formatPeso(s.amount_received_centavos)} />
        <Row label="Cost of sales (avg cost)" value={`-${formatPeso(s.cost_of_sales_centavos, false)}`} />
        <Row label="Gross profit" value={formatPeso(grossProfit)} />
        <Row label="Trucking" value={`-${formatPeso(s.trucking_centavos, false)}`} />
        <Row label="Labor" value={`-${formatPeso(s.labor_centavos, false)}`} />
        <Row label="Other" value={`-${formatPeso(s.other_expenses_centavos, false)}`} />
        <div className="flex justify-between border-t border-gray-100 py-2 text-lg">
          <span className="font-semibold">Net profit</span>
          <span className={netProfit >= 0 ? "font-bold text-brand-700" : "font-bold text-red-600"}>
            {formatPeso(netProfit)}
          </span>
        </div>
        {s.remarks && <p className="text-sm text-gray-500">Remarks: {s.remarks}</p>}
      </Card>

      {s.status === "posted" && (
        <Card className="border-red-200">
          <h2 className="mb-2 font-semibold text-red-700">Void this sale</h2>
          <p className="mb-3 text-sm text-gray-500">
            Voiding returns the drawn stock to inventory. It is never deleted.
          </p>
          <ActionForm action={voidSale} className="space-y-3">
            <input type="hidden" name="sale_id" value={s.id} />
            <Field label="Reason">
              <Input name="reason" required />
            </Field>
            <SubmitButton variant="danger">Void sale</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
