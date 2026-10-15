import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ReprintButton } from "@/components/ReprintButton";
import { DeleteButton } from "@/components/DeleteButton";
import { voidPurchase, deletePurchase } from "../actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDateTime } from "@/lib/format";
import type { ReceiptData } from "@/lib/escpos/receipt";
import type {
  Purchase,
  Farmer,
  FarmerBalanceView,
  Business,
  BusinessSettings,
  PurchaseWeighing,
} from "@/types/db";

export const dynamic = "force-dynamic";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const owner = isOwner(session?.profile);
  const supabase = await createClient();

  const { data: purchaseData } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!purchaseData) notFound();
  const p = purchaseData as Purchase;

  const [
    { data: farmerData },
    { data: balData },
    { data: biz },
    { data: settings },
    { data: weighingData },
  ] = await Promise.all([
    supabase.from("farmers").select("*").eq("id", p.farmer_id).maybeSingle(),
    supabase.from("v_farmer_balances").select("*").eq("farmer_id", p.farmer_id).maybeSingle(),
    supabase.from("businesses").select("*").limit(1).maybeSingle(),
    supabase.from("business_settings").select("*").limit(1).maybeSingle(),
    supabase
      .from("purchase_weighings")
      .select("*")
      .eq("purchase_id", id)
      .order("seq", { ascending: true }),
  ]);

  const farmer = farmerData as Farmer | null;
  const weighings = (weighingData ?? []) as PurchaseWeighing[];
  const receiptWeighings = weighings.map((w) => ({ sacks: w.sack_count, kg: w.weight_kg }));
  const currentBalance = (balData as FarmerBalanceView | null)?.balance_centavos ?? 0;
  const business = biz as Business | null;
  const header = (settings as BusinessSettings | null)?.receipt_header ?? {};

  // Best-effort reconstruction for reprint: remaining = current balance,
  // previous = remaining + what this receipt deducted.
  const receipt: ReceiptData = {
    businessName: (header["business_name"] as string) || business?.name || "CopraBooks",
    businessAddress: (header["address"] as string) || business?.address || undefined,
    footer: (header["footer"] as string) || undefined,
    receiptNo: p.receipt_no,
    purchasedAt: p.purchased_at,
    farmerName: farmer?.name ?? "Farmer",
    barangay: farmer?.barangay ?? null,
    weighings: receiptWeighings,
    sackCount: p.sack_count,
    grossKg: p.gross_kg,
    tareKg: p.tare_kg,
    deductionKg: p.deduction_kg,
    deductionPct: p.deduction_pct,
    netKg: p.net_kg,
    pricePerKgCentavos: p.price_per_kg_centavos,
    grossAmountCentavos: p.gross_amount_centavos,
    utangDeductedCentavos: p.utang_deducted_centavos,
    previousUtangCentavos: currentBalance + p.utang_deducted_centavos,
    remainingUtangCentavos: currentBalance,
    cashPaidCentavos: p.cash_paid_centavos,
    cashierName: session?.profile.full_name ?? null,
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Receipt #${p.receipt_no}`}
        subtitle={formatDateTime(p.purchased_at)}
        action={
          farmer ? (
            <Link href={`/farmers/${farmer.id}`} className="btn-secondary">
              {farmer.name}
            </Link>
          ) : undefined
        }
      />

      {p.status === "voided" && (
        <Card className="border-red-300 bg-red-50">
          <Badge tone="red">Voided</Badge>
          <p className="mt-1 text-sm text-red-700">{p.void_reason}</p>
        </Card>
      )}

      {weighings.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Weighings ({p.sack_count} sack{p.sack_count === 1 ? "" : "s"})
          </h2>
          <div className="divide-y divide-gray-100">
            {weighings.map((w) => (
              <div key={w.id} className="flex justify-between py-1 text-sm">
                <span className="text-gray-500">
                  #{w.seq} · {w.sack_count} sack{w.sack_count === 1 ? "" : "s"}
                </span>
                <span className="font-medium">{formatKg(w.weight_kg, false)} kg</span>
              </div>
            ))}
            <div className="flex justify-between py-1 text-sm">
              <span className="font-semibold">Total gross</span>
              <span className="font-semibold">{formatKg(p.gross_kg)}</span>
            </div>
          </div>
        </Card>
      )}

      <Card>
        {p.sack_count > 0 && <Row label="Sacks" value={String(p.sack_count)} />}
        <Row label="Gross" value={formatKg(p.gross_kg)} />
        <Row label="Tare (sacks)" value={`-${formatKg(p.tare_kg, false)}`} />
        <Row
          label={`Deduction ${p.deduction_pct}%`}
          value={`-${formatKg(p.deduction_kg, false)}`}
        />
        <div className="border-t border-gray-100" />
        <Row label="Net weight" value={formatKg(p.net_kg)} />
        <Row label="Price / kg" value={formatPeso(p.price_per_kg_centavos)} />
        <Row label="Gross amount" value={formatPeso(p.gross_amount_centavos)} />
        {p.utang_deducted_centavos > 0 && (
          <Row
            label="Utang deducted"
            value={`-${formatPeso(p.utang_deducted_centavos, false)}`}
          />
        )}
        <div className="border-t border-gray-100" />
        <div className="flex justify-between py-2 text-lg">
          <span className="font-semibold">Cash paid</span>
          <span className="font-bold text-brand-700">
            {formatPeso(p.cash_paid_centavos)}
          </span>
        </div>
        {p.remarks && (
          <p className="mt-2 text-sm text-gray-500">Remarks: {p.remarks}</p>
        )}
      </Card>

      {p.status === "posted" && (
        <div className="grid grid-cols-1 gap-3">
          <ReprintButton receipt={receipt} />
        </div>
      )}

      {owner && p.status === "posted" && (
        <Card className="border-red-200">
          <h2 className="mb-2 font-semibold text-red-700">Void this purchase</h2>
          <p className="mb-3 text-sm text-gray-500">
            Voiding reverses the record and restores any deducted utang. It is
            never deleted.
          </p>
          <ActionForm action={voidPurchase} className="space-y-3">
            <input type="hidden" name="purchase_id" value={p.id} />
            <Field label="Reason">
              <Input name="reason" required />
            </Field>
            <SubmitButton variant="danger">Void purchase</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {owner && (
        <Card className="border-red-200">
          <h2 className="mb-2 font-semibold text-red-700">Delete permanently</h2>
          <p className="mb-3 text-sm text-gray-500">
            Removes this purchase and its receipt, weighings, journal entries and
            any utang it deducted. Use this only to clear test data — it cannot be
            undone and leaves no record. To reverse a real purchase, use Void.
          </p>
          <DeleteButton
            action={deletePurchase}
            id={p.id}
            idField="purchase_id"
            confirmText={`Permanently delete receipt #${p.receipt_no}? This cannot be undone.`}
          >
            Delete permanently
          </DeleteButton>
        </Card>
      )}
    </div>
  );
}
