import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, LinkButton, Input, Badge } from "@/components/ui";
import { formatPeso } from "@/lib/money";
import type { FarmerBalanceView } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function FarmersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("v_farmer_balances")
    .select("*")
    .order("name");
  if (q && q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`);
  }
  const { data } = await query;
  const farmers = (data ?? []) as FarmerBalanceView[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Farmers"
        action={<LinkButton href="/farmers/new">+ New</LinkButton>}
      />

      <form method="get">
        <Input
          name="q"
          placeholder="Search by name…"
          defaultValue={q ?? ""}
          type="search"
        />
      </form>

      {farmers.length === 0 ? (
        <EmptyState>No farmers found.</EmptyState>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-gray-100">
            {farmers.map((f) => (
              <Link
                key={f.farmer_id}
                href={`/farmers/${f.farmer_id}`}
                className="flex items-center justify-between px-4 py-3 active:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-gray-400">
                    {f.barangay || "—"}
                    {f.mobile ? ` · ${f.mobile}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {f.balance_centavos > 0 ? (
                    <Badge tone="amber">
                      Utang {formatPeso(f.balance_centavos)}
                    </Badge>
                  ) : (
                    <Badge tone="green">Clear</Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
