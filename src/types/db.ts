// Hand-maintained Supabase types for the tables, views and RPCs CopraBooks
// uses in Phase 1. Regenerate with `supabase gen types typescript` once the
// project is linked; until then this keeps the app type-safe.

export type UserRole = "owner" | "cashier";
export type UtangDirection = "advance" | "repayment";
export type UtangSource =
  | "cash_advance"
  | "purchase_deduction"
  | "direct_cash"
  | "adjustment"
  | "void";
export type UtangStatus = "pending" | "posted" | "rejected";
export type PurchaseStatus = "posted" | "voided";

export interface Profile {
  id: string;
  business_id: string;
  role: UserRole;
  full_name: string | null;
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  address: string | null;
  tz: string;
  currency: string;
  created_at: string;
}

export interface BusinessSettings {
  business_id: string;
  shrinkage_threshold_pct: number;
  advance_approval_limit_centavos: number;
  receipt_header: Record<string, unknown>;
  updated_at: string;
}

export interface Grade {
  id: string;
  business_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface BuyingPrice {
  id: string;
  business_id: string;
  effective_date: string;
  grade_id: string | null;
  price_per_kg_centavos: number;
  set_by: string | null;
  created_at: string;
}

export interface BuyerReferencePrice {
  id: string;
  business_id: string;
  effective_date: string;
  price_per_kg_centavos: number;
  set_by: string | null;
  created_at: string;
}

export interface Farmer {
  id: string;
  business_id: string;
  name: string;
  barangay: string | null;
  mobile: string | null;
  notes: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UtangLedgerRow {
  id: string;
  business_id: string;
  farmer_id: string;
  entry_date: string;
  direction: UtangDirection;
  amount_centavos: number;
  source_type: UtangSource;
  source_id: string | null;
  status: UtangStatus;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Purchase {
  id: string;
  business_id: string;
  receipt_no: number;
  farmer_id: string;
  grade_id: string | null;
  purchased_at: string;
  sack_count: number;
  gross_kg: number;
  tare_kg: number;
  deduction_kg: number;
  deduction_pct: number;
  net_kg: number;
  price_per_kg_centavos: number;
  gross_amount_centavos: number;
  utang_deducted_centavos: number;
  cash_paid_centavos: number;
  remarks: string | null;
  scale_photo_url: string | null;
  client_uuid: string | null;
  status: PurchaseStatus;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  void_reason: string | null;
  voided_at: string | null;
}

export interface FarmerBalanceView {
  farmer_id: string;
  business_id: string;
  name: string;
  barangay: string | null;
  mobile: string | null;
  active: boolean;
  advances_centavos: number;
  repayments_centavos: number;
  balance_centavos: number;
}

export interface FarmerDeductionAvgView {
  business_id: string;
  farmer_id: string;
  avg_deduction_pct: number;
  purchase_count: number;
}

export interface UtangAgingView {
  business_id: string;
  farmer_id: string;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total_outstanding: number;
}

export interface DashboardTodayView {
  business_id: string;
  today_net_kg: number;
  today_gross_centavos: number;
  today_cash_out_centavos: number;
  today_purchase_count: number;
  total_utang_outstanding_centavos: number;
  // Phase 2
  stock_on_hand_kg: number;
  stock_value_centavos: number;
  stock_value_at_buyer_centavos: number;
  month_net_profit_centavos: number;
  month_gross_profit_centavos: number;
  avg_deduction_gap_pct: number | null;
  month_shrinkage_pct: number | null;
}

// ---- Phase 2: inventory & sales -------------------------------------------
export type PaymentMethod = "cash" | "bank" | "gcash";
export type SaleStatus = "posted" | "voided";

export interface InventoryState {
  business_id: string;
  qty_on_hand_kg: number;
  total_value_centavos: number;
  avg_cost_centavos: number;
  updated_at: string;
}

export type InventoryMovementType =
  | "purchase_in"
  | "purchase_void"
  | "sale_out"
  | "shrinkage"
  | "count_adj"
  | "sale_void";

export interface InventoryMovement {
  id: string;
  business_id: string;
  movement_type: InventoryMovementType;
  qty_kg: number;
  unit_cost_centavos: number | null;
  total_cost_centavos: number;
  source_type: string;
  source_id: string | null;
  balance_qty_after: number;
  balance_value_after: number;
  occurred_at: string;
  created_at: string;
}

export interface Buyer {
  id: string;
  business_id: string;
  name: string;
  contact: string | null;
  notes: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  business_id: string;
  sale_no: number;
  buyer_id: string | null;
  sale_date: string;
  plate_no: string | null;
  driver: string | null;
  our_loaded_kg: number;
  our_avg_deduction_pct: number;
  buyer_gross_kg: number | null;
  buyer_deduction_pct: number | null;
  buyer_net_kg: number | null;
  price_per_kg_centavos: number;
  amount_received_centavos: number;
  payment_method: PaymentMethod | null;
  trucking_centavos: number;
  labor_centavos: number;
  other_expenses_centavos: number;
  book_kg: number;
  shrinkage_kg: number;
  shrinkage_flag: boolean;
  cost_of_sales_centavos: number;
  shrinkage_value_centavos: number;
  remarks: string | null;
  status: SaleStatus;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  void_reason: string | null;
  voided_at: string | null;
}

export interface StockCount {
  id: string;
  business_id: string;
  count_date: string;
  counted_kg: number;
  book_kg: number;
  variance_kg: number;
  adjustment_value_centavos: number;
  remarks: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface SaleProfitView {
  id: string;
  business_id: string;
  sale_no: number;
  sale_date: string;
  buyer_id: string | null;
  revenue_centavos: number;
  cogs_centavos: number;
  expenses_centavos: number;
  shrinkage_value_centavos: number;
  gross_profit_centavos: number;
  net_profit_centavos: number;
}

export interface SaleReconciliationView {
  id: string;
  business_id: string;
  sale_no: number;
  sale_date: string;
  buyer_id: string | null;
  our_loaded_kg: number;
  buyer_gross_kg: number | null;
  our_avg_deduction_pct: number;
  buyer_deduction_pct: number | null;
  weight_gap_kg: number;
  weight_gap_pct: number;
  deduction_gap_pct: number;
  running_avg_deduction_gap_pct: number;
  running_avg_weight_gap_pct: number;
}
