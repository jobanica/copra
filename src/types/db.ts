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
  signature_data?: string | null;
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

export interface PurchaseWeighing {
  id: string;
  business_id: string;
  purchase_id: string;
  seq: number;
  sack_count: number;
  weight_kg: number;
  created_at: string;
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

// ---- Phase 3: accounting & cash -------------------------------------------
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type NormalBalance = "debit" | "credit";
export type EquityType = "capital_in" | "drawing" | "transfer";
export type CashDayStatus = "open" | "counted" | "closed";

export interface GlAccount {
  id: string;
  business_id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  is_cash: boolean;
  is_system: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface AccountingPeriod {
  id: string;
  business_id: string;
  year: number;
  month: number;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  business_id: string;
  entry_no: number;
  entry_date: string;
  source_type: string;
  source_id: string | null;
  memo: string | null;
  is_manual: boolean;
  status: "posted" | "reversed";
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  period_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface JournalLine {
  id: string;
  entry_id: string;
  business_id: string;
  account_id: string;
  debit_centavos: number;
  credit_centavos: number;
  line_memo: string | null;
}

export interface CashAccount {
  id: string;
  business_id: string;
  name: string;
  type: "cash_on_hand" | "bank" | "gcash";
  gl_account_id: string;
  active: boolean;
  created_at: string;
}

export interface Expense {
  id: string;
  business_id: string;
  expense_date: string;
  expense_account_id: string;
  cash_account_id: string;
  amount_centavos: number;
  remarks: string | null;
  receipt_photo_url: string | null;
  status: "posted" | "voided";
  created_by: string | null;
  created_at: string;
}

export interface EquityTransaction {
  id: string;
  business_id: string;
  txn_date: string;
  type: EquityType;
  amount_centavos: number;
  cash_account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  remarks: string | null;
  status: "posted" | "voided";
  created_by: string | null;
  created_at: string;
}

export interface CashDay {
  id: string;
  business_id: string;
  business_date: string;
  opening_float_centavos: number;
  status: CashDayStatus;
  opened_by: string | null;
  closed_by: string | null;
  approved_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface CashCount {
  id: string;
  business_id: string;
  cash_day_id: string;
  counted_centavos: number;
  expected_centavos: number;
  variance_centavos: number;
  denominations: unknown;
  counted_by: string | null;
  created_at: string;
}

export interface AccountBalanceView {
  account_id: string;
  business_id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  sort_order: number;
  debit_total_centavos: number;
  credit_total_centavos: number;
  debit_minus_credit_centavos: number;
  balance_centavos: number;
}

export interface TrialBalanceView {
  account_id: string;
  business_id: string;
  code: string;
  name: string;
  type: AccountType;
  sort_order: number;
  debit_balance_centavos: number;
  credit_balance_centavos: number;
}

export interface GeneralLedgerView {
  line_id: string;
  business_id: string;
  account_id: string;
  code: string;
  name: string;
  entry_no: number;
  entry_date: string;
  source_type: string;
  memo: string | null;
  status: string;
  debit_centavos: number;
  credit_centavos: number;
  running_debit_minus_credit_centavos: number;
}

export interface PlSummaryView {
  business_id: string;
  type: AccountType;
  balance_centavos: number;
}

export type PayableStatus = "open" | "paid" | "void";

export interface Payable {
  id: string;
  business_id: string;
  payee: string;
  category: string | null;
  amount_centavos: number;
  offset_account_id: string;
  incurred_date: string;
  due_date: string | null;
  remarks: string | null;
  status: PayableStatus;
  created_by: string | null;
  created_at: string;
}

export interface PayableBalanceView {
  payable_id: string;
  business_id: string;
  payee: string;
  category: string | null;
  amount_centavos: number;
  incurred_date: string;
  due_date: string | null;
  remarks: string | null;
  status: PayableStatus;
  paid_centavos: number;
  balance_centavos: number;
}

/** Result row of the cash_balances() RPC. */
export interface CashBalanceRow {
  cash_account_id: string;
  name: string;
  type: "cash_on_hand" | "bank" | "gcash";
  balance_centavos: number;
}
