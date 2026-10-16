import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Badge, EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { AdvanceForm } from "@/components/AdvanceForm";
import { DeleteButton } from "@/components/DeleteButton";
import { recordRepayment, deleteUtangEntry } from "../../utang/actions";
import { deleteFarmer } from "../actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDate } from "@/lib/format";
import type {
  Farmer,
  FarmerBalanceView,
  FarmerDeductionAvgView,
  UtangAgingView,
  UtangLedgerRow,
  Purchase,
  Business,
  BusinessSettings,
} from "@/types/db";

export const dynamic = "force-dynamic";

export default async function FarmerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const supabase = await createClient();

  const { data: farmerData } = await supabase
    .from("farmers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!farmerData) notFound();
  const farmer = farmerData as Farmer;

  const [
    { data: bal },
    { data: ded },
    { data: aging },
    { data: ledger },
    { data: purchases },
    { data: biz },
    { data: settings },
  ] = await Promise.all([
    supabase.from("v_farmer_balances").select("*").eq("farmer_id", id).maybeSingle(),
    supabase.from("v_farmer_deduction_avg").select("*").eq("farmer_id", id).maybeSingle(),
    supabase.from("v_utang_aging").select("*").eq("farmer_id", id).maybeSingle(),
    supabase
      .from("utang_ledger")
      .select(
        "id,farmer_id,entry_date,direction,amount_centavos,source_type,source_id,status,requires_approval,approved_by,approved_at,remarks,created_by,created_at",
      )
      .eq("farmer_id", id)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("purchases")
      .select("*")
      .eq("farmer_id", id)
      .order("purchased_at", { ascending: false })
      .limit(20),
    supabase.from("businesses").select("*").limit(1).maybeSingle(),
    supabase.from("business_settings").select("*").limit(1).maybeSingle(),
  ]);

  const balance = (bal as FarmerBalanceView | null)?.balance_centavos ?? 0;
  const dedAvg = (ded as FarmerDeductionAvgView | null)?.avg_deduction_pct ?? null;
  const ag = aging as UtangAgingView | null;
  const ledgerRows = (ledger ?? []) as UtangLedgerRow[];
  const purchaseRows = (purchases ?? []) as Purchase[];

  const business = biz as Business | null;
  const header = (settings as BusinessSettings | null)?.receipt_header ?? {};
  const businessInfo = {
    name: business?.name || (header["business_name"] as string) || "CopraBooks",
    address: business?.address || (header["address"] as string) || undefined,
    footer: (header["footer"] as string) || undefined,
  };
  const cashierName = session?.profile.full_name ?? session?.email ?? null;
  const owner = session?.profile.role === "owner";

  return (
    <div className="space-y-4">
      <PageHeader
        title={farmer.name}
        subtitle={[farmer.barangay, farmer.mobile].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex gap-2">
            <Link href={`/farmers/${id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <Link href={`/farmers/${id}/statement`} className="btn-secondary">
              Statement
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-sm text-gray-500">Utang balance</div>
          <div className="mt-1 text-2xl font-bold">{formatPeso(balance)}</div>
          {balance > 0 ? (
            <Badge tone="amber">Owes us</Badge>
          ) : (
            <Badge tone="green">Clear</Badge>
          )}
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Avg deduction</div>
          <div className="mt-1 text-2xl font-bold">
            {dedAvg !== null ? `${dedAvg}%` : "—"}
          </div>
          <div className="text-xs text-gray-400">
            {(ded as FarmerDeductionAvgView | null)?.purchase_count ?? 0} purchases
          </div>
        </Card>
      </div>

      {ag && ag.total_outstanding > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Aging</h2>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <div className="text-gray-400">0–30</div>
              <div className="font-semibold">{formatPeso(ag.bucket_0_30, false)}</div>
            </div>
            <div>
              <div className="text-gray-400">31–60</div>
              <div className="font-semibold">{formatPeso(ag.bucket_31_60, false)}</div>
            </div>
            <div>
              <div className="text-gray-400">61–90</div>
              <div className="font-semibold">{formatPeso(ag.bucket_61_90, false)}</div>
            </div>
            <div>
              <div className="text-gray-400">90+</div>
              <div className="font-semibold">{formatPeso(ag.bucket_90_plus, false)}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Give cash advance</h2>
          <AdvanceForm
            farmerId={id}
            farmerName={farmer.name}
            barangay={farmer.barangay}
            balanceCentavos={balance}
            business={businessInfo}
            cashierName={cashierName}
          />
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Cash repayment</h2>
          <ActionForm action={recordRepayment} className="space-y-3">
            <input type="hidden" name="farmer_id" value={id} />
            <Field label="Amount (₱)">
              <Input type="number" name="amount" step="0.01" min="0" inputMode="decimal" required />
            </Field>
            <Field label="Remarks">
              <Input name="remarks" />
            </Field>
            <SubmitButton variant="secondary">Record repayment</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Utang ledger</h2>
        {ledgerRows.length === 0 ? (
          <EmptyState>No advances or repayments yet.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {ledgerRows.map((l) => {
              const inner = (
                <>
                  <div>
                    <div className="font-medium capitalize">
                      {l.direction === "advance" ? "Advance" : "Repayment"}
                      {l.status !== "posted" && (
                        <span className="ml-2">
                          <Badge tone={l.status === "pending" ? "amber" : "red"}>
                            {l.status}
                          </Badge>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDate(l.entry_date)} · {l.source_type.replace(/_/g, " ")}
                      {l.direction === "advance" && " · 🧾 receipt"}
                    </div>
                  </div>
                  <div
                    className={
                      l.direction === "advance"
                        ? "font-semibold text-red-600"
                        : "font-semibold text-brand-700"
                    }
                  >
                    {l.direction === "advance" ? "+" : "−"}
                    {formatPeso(l.amount_centavos, false)}
                  </div>
                </>
              );
              return (
                <div key={l.id} className="flex items-center gap-2">
                  {l.direction === "advance" ? (
                    <Link
                      href={`/utang/${l.id}`}
                      className="flex flex-1 items-center justify-between py-2 text-sm active:bg-gray-50"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex flex-1 items-center justify-between py-2 text-sm">
                      {inner}
                    </div>
                  )}
                  {owner && (
                    <DeleteButton
                      action={deleteUtangEntry}
                      id={l.id}
                      idField="ledger_id"
                      confirmText="Permanently delete this utang entry? This cannot be undone."
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      ✕
                    </DeleteButton>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Recent purchases</h2>
        {purchaseRows.length === 0 ? (
          <EmptyState>No purchases yet.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {purchaseRows.map((p) => (
              <Link
                key={p.id}
                href={`/purchases/${p.id}`}
                className="flex items-center justify-between py-2 text-sm active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">
                    #{p.receipt_no} · {formatKg(p.net_kg)}
                    {p.status === "voided" && (
                      <span className="ml-2">
                        <Badge tone="red">voided</Badge>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(p.purchased_at)}</div>
                </div>
                <div className="font-semibold">{formatPeso(p.gross_amount_centavos)}</div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {owner && (
        <Card className="border-red-200">
          <h2 className="mb-2 font-semibold text-red-700">Delete farmer</h2>
          <p className="mb-3 text-sm text-gray-500">
            Permanently removes {farmer.name} <strong>and all of their purchases
            and utang entries</strong> (with the related receipts and journal
            entries). Use this only to clear test data — it cannot be undone.
          </p>
          <DeleteButton
            action={deleteFarmer}
            id={id}
            idField="farmer_id"
            confirmText={`Permanently delete ${farmer.name} and ALL of their purchases and utang? This cannot be undone.`}
          >
            Delete this farmer
          </DeleteButton>
        </Card>
      )}
    </div>
  );
}
