import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { PageHeader, Card, EmptyState, LinkButton, Badge, Input, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { addBuyer } from "./actions";
import { formatPeso } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { formatDate } from "@/lib/format";
import type { Sale, Buyer, SaleProfitView } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isOwner(session.profile)) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: sales }, { data: buyers }, { data: profits }] = await Promise.all([
    supabase.from("sales").select("*").order("sale_date", { ascending: false }).limit(50),
    supabase.from("buyers").select("*").order("name"),
    supabase.from("v_sale_profit").select("*"),
  ]);

  const saleRows = (sales ?? []) as Sale[];
  const buyerList = (buyers ?? []) as Buyer[];
  const profitRows = (profits ?? []) as SaleProfitView[];
  const buyerName = new Map(buyerList.map((b) => [b.id, b.name]));
  const profitOf = new Map(profitRows.map((p) => [p.id, p.net_profit_centavos]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Truckload sales"
        action={<LinkButton href="/sales/new">+ Sale</LinkButton>}
      />

      {saleRows.length === 0 ? (
        <EmptyState>No sales yet.</EmptyState>
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-gray-100">
            {saleRows.map((s) => {
              const net = profitOf.get(s.id);
              return (
                <Link
                  key={s.id}
                  href={`/sales/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 active:bg-gray-50"
                >
                  <div>
                    <div className="font-medium">
                      #{s.sale_no} · {s.buyer_id ? buyerName.get(s.buyer_id) : "—"}
                      {s.status === "voided" && (
                        <span className="ml-2">
                          <Badge tone="red">voided</Badge>
                        </span>
                      )}
                      {s.shrinkage_flag && s.status === "posted" && (
                        <span className="ml-2">
                          <Badge tone="amber">high shrink</Badge>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDate(s.sale_date)} · {formatKg(s.our_loaded_kg)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatPeso(s.amount_received_centavos)}</div>
                    {s.status === "posted" && net !== undefined && (
                      <div
                        className={
                          net >= 0 ? "text-xs text-brand-700" : "text-xs text-red-600"
                        }
                      >
                        net {formatPeso(net)}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Buyers / traders</h2>
        {buyerList.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {buyerList.map((b) => (
              <Badge key={b.id}>{b.name}</Badge>
            ))}
          </div>
        )}
        <ActionForm action={addBuyer} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Contact">
              <Input name="contact" />
            </Field>
          </div>
          <SubmitButton variant="secondary">Add buyer</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
