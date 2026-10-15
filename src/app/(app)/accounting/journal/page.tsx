import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { JournalEntry, JournalLine } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("*")
    .order("entry_no", { ascending: false })
    .limit(60);
  const entryRows = (entries ?? []) as JournalEntry[];

  const ids = entryRows.map((e) => e.id);
  const { data: lines } = ids.length
    ? await supabase.from("journal_lines").select("entry_id,debit_centavos").in("entry_id", ids)
    : { data: [] };
  const totals = new Map<string, number>();
  for (const l of (lines ?? []) as Pick<JournalLine, "entry_id" | "debit_centavos">[]) {
    totals.set(l.entry_id, (totals.get(l.entry_id) ?? 0) + l.debit_centavos);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="General journal" />
      {entryRows.length === 0 ? (
        <EmptyState>No journal entries yet.</EmptyState>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-gray-100">
            {entryRows.map((e) => (
              <Link
                key={e.id}
                href={`/accounting/journal/${e.id}`}
                className="flex items-center justify-between px-4 py-3 active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">
                    #{e.entry_no} · {e.source_type.replace(/_/g, " ")}
                    {e.status === "reversed" && (
                      <span className="ml-2">
                        <Badge tone="red">reversed</Badge>
                      </span>
                    )}
                    {e.is_manual && (
                      <span className="ml-2">
                        <Badge tone="amber">manual</Badge>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDate(e.entry_date)}
                    {e.memo ? ` · ${e.memo}` : ""}
                  </div>
                </div>
                <div className="font-semibold">{formatPeso(totals.get(e.id) ?? 0)}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
