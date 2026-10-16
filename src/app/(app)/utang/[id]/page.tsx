import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { AdvanceReceiptView } from "@/components/AdvanceReceiptView";
import type { AdvanceReceiptData } from "@/lib/escpos/advanceReceipt";
import type {
  UtangLedgerRow,
  Farmer,
  Business,
  BusinessSettings,
} from "@/types/db";

export const dynamic = "force-dynamic";

interface LedgerSlim {
  direction: "advance" | "repayment";
  amount_centavos: number;
  status: string;
  created_at: string;
}

export default async function AdvanceReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  const supabase = await createClient();

  // Target ledger row, including the stored signature.
  const { data: rowData } = await supabase
    .from("utang_ledger")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!rowData) notFound();
  const row = rowData as UtangLedgerRow;

  const [{ data: farmerData }, { data: allLedger }, { data: biz }, { data: settings }] =
    await Promise.all([
      supabase.from("farmers").select("*").eq("id", row.farmer_id).maybeSingle(),
      supabase
        .from("utang_ledger")
        .select("direction,amount_centavos,status,created_at")
        .eq("farmer_id", row.farmer_id),
      supabase.from("businesses").select("*").limit(1).maybeSingle(),
      supabase.from("business_settings").select("*").limit(1).maybeSingle(),
    ]);

  const farmer = (farmerData ?? null) as Farmer | null;
  if (!farmer) notFound();

  // Reconstruct the running balance as it stood when this entry was created.
  const ledger = (allLedger ?? []) as LedgerSlim[];
  let postedUpToIncl = 0;
  for (const l of ledger) {
    if (l.status !== "posted") continue;
    if (l.created_at > row.created_at) continue;
    postedUpToIncl += l.direction === "advance" ? l.amount_centavos : -l.amount_centavos;
  }

  const pending = row.status === "pending";
  const rejected = row.status === "rejected";
  let previousBalance: number;
  let newBalance: number;
  if (row.direction === "advance" && row.status === "posted") {
    newBalance = postedUpToIncl;
    previousBalance = newBalance - row.amount_centavos;
  } else {
    // Pending / rejected advance: not yet reflected in the posted balance.
    previousBalance = postedUpToIncl;
    newBalance = pending ? previousBalance + row.amount_centavos : previousBalance;
  }

  const business = biz as Business | null;
  const header = (settings as BusinessSettings | null)?.receipt_header ?? {};
  const data: AdvanceReceiptData = {
    businessName: business?.name || (header["business_name"] as string) || "CopraBooks",
    businessAddress: business?.address || (header["address"] as string) || undefined,
    footer: (header["footer"] as string) || undefined,
    farmerName: farmer.name,
    barangay: farmer.barangay,
    dateISO: row.created_at,
    amountCentavos: row.amount_centavos,
    previousBalanceCentavos: previousBalance,
    newBalanceCentavos: newBalance,
    pending,
    cashierName: session?.profile.full_name ?? session?.email ?? null,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Advance receipt"
        subtitle={farmer.name}
        action={
          <Link href={`/farmers/${farmer.id}`} className="btn-secondary">
            Back to farmer
          </Link>
        }
      />
      {row.direction !== "advance" ? (
        <Card>
          <p className="text-sm text-gray-500">
            This entry is a repayment, not a cash advance, so it has no signed advance
            receipt.
          </p>
        </Card>
      ) : (
        <AdvanceReceiptView data={data} signature={row.signature_data ?? null} rejected={rejected} />
      )}
    </div>
  );
}
