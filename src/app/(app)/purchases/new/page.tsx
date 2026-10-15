import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import {
  PurchaseForm,
  type FarmerOption,
  type GradeOption,
} from "@/components/PurchaseForm";
import { manilaToday } from "@/lib/format";
import type { FarmerBalanceView, Grade, BuyingPrice, Business, BusinessSettings } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
  const session = await getSessionProfile();
  const supabase = await createClient();
  const today = manilaToday();

  const [{ data: farmers }, { data: grades }, { data: prices }, { data: biz }, { data: settings }] =
    await Promise.all([
      supabase.from("v_farmer_balances").select("*").eq("active", true).order("name"),
      supabase.from("grades").select("*").eq("active", true).order("name"),
      supabase.from("buying_prices").select("*").eq("effective_date", today),
      supabase.from("businesses").select("*").limit(1).maybeSingle(),
      supabase.from("business_settings").select("*").limit(1).maybeSingle(),
    ]);

  const farmerOptions: FarmerOption[] = ((farmers ?? []) as FarmerBalanceView[]).map(
    (f) => ({
      id: f.farmer_id,
      name: f.name,
      barangay: f.barangay,
      balance_centavos: f.balance_centavos,
    }),
  );
  const gradeOptions: GradeOption[] = ((grades ?? []) as Grade[]).map((g) => ({
    id: g.id,
    name: g.name,
  }));

  const priceByGrade: Record<string, number> = {};
  for (const p of (prices ?? []) as BuyingPrice[]) {
    priceByGrade[p.grade_id ?? "null"] = p.price_per_kg_centavos;
  }

  const business = biz as Business | null;
  const header = (settings as BusinessSettings | null)?.receipt_header ?? {};
  const businessInfo = {
    name: (header["business_name"] as string) || business?.name || "CopraBooks",
    address: (header["address"] as string) || business?.address || undefined,
    footer: (header["footer"] as string) || undefined,
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Record purchase" />
      <PurchaseForm
        farmers={farmerOptions}
        grades={gradeOptions}
        priceByGrade={priceByGrade}
        today={today}
        business={businessInfo}
        cashierName={session?.profile.full_name ?? session?.email ?? null}
      />
    </div>
  );
}
