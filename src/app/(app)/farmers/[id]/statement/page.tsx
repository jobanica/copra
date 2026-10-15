import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { formatPeso } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { Farmer, UtangLedgerRow, Business } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: farmerData }, { data: bizData }, { data: ledger }] =
    await Promise.all([
      supabase.from("farmers").select("*").eq("id", id).maybeSingle(),
      supabase.from("businesses").select("*").limit(1).maybeSingle(),
      supabase
        .from("utang_ledger")
        .select("*")
        .eq("farmer_id", id)
        .eq("status", "posted")
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (!farmerData) notFound();
  const farmer = farmerData as Farmer;
  const business = bizData as Business | null;
  const rows = (ledger ?? []) as UtangLedgerRow[];

  let running = 0;
  const withBalance = rows.map((r) => {
    running += r.direction === "advance" ? r.amount_centavos : -r.amount_centavos;
    return { ...r, running };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Farmer statement</h1>
        <PrintButton />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm">
        <div className="text-center">
          <div className="text-lg font-bold">{business?.name ?? "CopraBooks"}</div>
          {business?.address && <div className="text-gray-500">{business.address}</div>}
          <div className="mt-2 font-semibold">Statement of Account</div>
        </div>

        <div className="mt-4">
          <div className="font-semibold">{farmer.name}</div>
          <div className="text-gray-500">
            {[farmer.barangay, farmer.mobile].filter(Boolean).join(" · ")}
          </div>
        </div>

        <div className="mt-4 -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left">
              <th className="py-1">Date</th>
              <th className="py-1">Description</th>
              <th className="py-1 text-right">Advance</th>
              <th className="py-1 text-right">Repay</th>
              <th className="py-1 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-1">{formatDate(r.entry_date)}</td>
                <td className="py-1 capitalize">{r.source_type.replace(/_/g, " ")}</td>
                <td className="py-1 text-right">
                  {r.direction === "advance" ? formatPeso(r.amount_centavos, false) : ""}
                </td>
                <td className="py-1 text-right">
                  {r.direction === "repayment" ? formatPeso(r.amount_centavos, false) : ""}
                </td>
                <td className="py-1 text-right font-medium">{formatPeso(r.running, false)}</td>
              </tr>
            ))}
            {withBalance.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-gray-400">
                  No activity.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 text-right font-semibold">
                Current balance
              </td>
              <td className="py-2 text-right font-bold">{formatPeso(running, false)}</td>
            </tr>
          </tfoot>
        </table>
        </div>

        <div className="mt-6 text-xs text-gray-400">
          Printed {formatDate(new Date())}
        </div>
      </div>
    </div>
  );
}
