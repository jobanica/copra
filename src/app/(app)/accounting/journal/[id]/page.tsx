import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { JournalEntry, JournalLine, GlAccount } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: entryData } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!entryData) notFound();
  const entry = entryData as JournalEntry;

  const [{ data: lines }, { data: accounts }] = await Promise.all([
    supabase.from("journal_lines").select("*").eq("entry_id", id),
    supabase.from("gl_accounts").select("*"),
  ]);
  const lineRows = (lines ?? []) as JournalLine[];
  const acct = new Map(((accounts ?? []) as GlAccount[]).map((a) => [a.id, a]));

  const totalDebit = lineRows.reduce((s, l) => s + l.debit_centavos, 0);
  const totalCredit = lineRows.reduce((s, l) => s + l.credit_centavos, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Entry #${entry.entry_no}`}
        subtitle={`${formatDate(entry.entry_date)} · ${entry.source_type.replace(/_/g, " ")}`}
      />

      {(entry.status === "reversed" || entry.is_manual) && (
        <div className="flex gap-2">
          {entry.status === "reversed" && <Badge tone="red">reversed</Badge>}
          {entry.is_manual && <Badge tone="amber">manual</Badge>}
        </div>
      )}

      {entry.memo && <p className="text-sm text-gray-600">{entry.memo}</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400">
              <th className="px-4 py-2">Account</th>
              <th className="px-4 py-2 text-right">Debit</th>
              <th className="px-4 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lineRows.map((l) => {
              const a = acct.get(l.account_id);
              return (
                <tr key={l.id} className="border-b border-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium">{a ? `${a.code} ${a.name}` : "—"}</div>
                    {l.line_memo && <div className="text-xs text-gray-400">{l.line_memo}</div>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {l.debit_centavos ? formatPeso(l.debit_centavos, false) : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {l.credit_centavos ? formatPeso(l.credit_centavos, false) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{formatPeso(totalDebit, false)}</td>
              <td className="px-4 py-2 text-right">{formatPeso(totalCredit, false)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}
