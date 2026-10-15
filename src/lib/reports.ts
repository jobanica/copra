// Shared report builders used by both the report pages (HTML) and the Excel
// export route. Each returns a normalized table so the two renderers agree.

export type ReportKey =
  | "income-statement"
  | "balance-sheet"
  | "trial-balance"
  | "ledger"
  | "cash-book"
  | "expenses"
  | "monthly";

export interface ReportColumn {
  label: string;
  numeric?: boolean;
}
export type Cell = string | number | null;
export interface ReportRow {
  cells: Cell[];
  bold?: boolean;
}
export interface ReportData {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportParams {
  from?: string;
  to?: string;
  as_of?: string;
  account?: string;
  year?: string;
}

export const REPORTS: { key: ReportKey; title: string; icon: string }[] = [
  { key: "income-statement", title: "Income statement", icon: "📈" },
  { key: "balance-sheet", title: "Balance sheet", icon: "⚖️" },
  { key: "trial-balance", title: "Trial balance", icon: "🧾" },
  { key: "ledger", title: "General ledger", icon: "📚" },
  { key: "cash-book", title: "Cash book", icon: "💵" },
  { key: "expenses", title: "Expense report", icon: "🧮" },
  { key: "monthly", title: "Monthly summary", icon: "📅" },
];

interface MinimalClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown }>;
}

const c2p = (centavos: number | null | undefined) => (centavos ?? 0) / 100;
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ActivityRow {
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  debit_centavos: number;
  credit_centavos: number;
  balance_centavos: number;
}

export async function getReportData(
  supabase: MinimalClient,
  report: ReportKey,
  params: ReportParams,
): Promise<ReportData> {
  switch (report) {
    case "income-statement": {
      const { data } = await supabase.rpc("report_account_activity", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
      });
      const rows = (data as ActivityRow[]) ?? [];
      const income = rows.filter((r) => r.type === "income");
      const expense = rows.filter((r) => r.type === "expense");
      const incomeTotal = income.reduce((s, r) => s + r.balance_centavos, 0);
      const expenseTotal = expense.reduce((s, r) => s + r.balance_centavos, 0);
      const out: ReportRow[] = [{ cells: ["Income", null], bold: true }];
      income.forEach((r) => out.push({ cells: [r.name, c2p(r.balance_centavos)] }));
      out.push({ cells: ["Total income", c2p(incomeTotal)], bold: true });
      out.push({ cells: ["Expenses", null], bold: true });
      expense.forEach((r) => out.push({ cells: [r.name, c2p(r.balance_centavos)] }));
      out.push({ cells: ["Total expenses", c2p(expenseTotal)], bold: true });
      out.push({ cells: ["Net income", c2p(incomeTotal - expenseTotal)], bold: true });
      return {
        title: "Income statement",
        subtitle: `${params.from ?? "start"} to ${params.to ?? "today"}`,
        columns: [{ label: "Account" }, { label: "Amount (₱)", numeric: true }],
        rows: out,
      };
    }
    case "balance-sheet": {
      const { data } = await supabase.rpc("report_account_activity", {
        p_from: null,
        p_to: params.as_of ?? null,
      });
      const rows = (data as ActivityRow[]) ?? [];
      const assets = rows.filter((r) => r.type === "asset");
      const liab = rows.filter((r) => r.type === "liability");
      const equity = rows.filter((r) => r.type === "equity");
      const income = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.balance_centavos, 0);
      const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balance_centavos, 0);
      const netIncome = income - expense;
      const assetsTotal = assets.reduce((s, r) => s + r.balance_centavos, 0);
      const liabTotal = liab.reduce((s, r) => s + r.balance_centavos, 0);
      const equityTotal =
        equity.reduce((s, r) => s + (r.normal_balance === "credit" ? r.balance_centavos : -r.balance_centavos), 0) +
        netIncome;
      const out: ReportRow[] = [{ cells: ["Assets", null], bold: true }];
      assets.forEach((r) => out.push({ cells: [r.name, c2p(r.balance_centavos)] }));
      out.push({ cells: ["Total assets", c2p(assetsTotal)], bold: true });
      out.push({ cells: ["Liabilities & equity", null], bold: true });
      liab.forEach((r) => out.push({ cells: [r.name, c2p(r.balance_centavos)] }));
      equity.forEach((r) =>
        out.push({
          cells: [r.name, r.normal_balance === "credit" ? c2p(r.balance_centavos) : -c2p(r.balance_centavos)],
        }),
      );
      out.push({ cells: ["Net income (retained)", c2p(netIncome)] });
      out.push({ cells: ["Total liabilities & equity", c2p(liabTotal + equityTotal)], bold: true });
      return {
        title: "Balance sheet",
        subtitle: `as of ${params.as_of ?? "today"}`,
        columns: [{ label: "Account" }, { label: "Amount (₱)", numeric: true }],
        rows: out,
      };
    }
    case "trial-balance": {
      const { data } = await supabase.rpc("report_account_activity", {
        p_from: null,
        p_to: params.as_of ?? null,
      });
      const rows = ((data as ActivityRow[]) ?? []).filter(
        (r) => r.balance_centavos !== 0,
      );
      const out: ReportRow[] = [];
      let dr = 0;
      let cr = 0;
      rows.forEach((r) => {
        const signed = r.normal_balance === "debit" ? r.balance_centavos : -r.balance_centavos;
        const debit = signed > 0 ? signed : 0;
        const credit = signed < 0 ? -signed : 0;
        dr += debit;
        cr += credit;
        out.push({ cells: [`${r.code} ${r.name}`, debit ? c2p(debit) : null, credit ? c2p(credit) : null] });
      });
      out.push({ cells: ["Total", c2p(dr), c2p(cr)], bold: true });
      return {
        title: "Trial balance",
        subtitle: `as of ${params.as_of ?? "today"}`,
        columns: [
          { label: "Account" },
          { label: "Debit (₱)", numeric: true },
          { label: "Credit (₱)", numeric: true },
        ],
        rows: out,
      };
    }
    case "ledger": {
      const { data } = await supabase.rpc("report_general_ledger", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
        p_account_id: params.account || null,
      });
      const rows =
        (data as {
          entry_no: number; entry_date: string; code: string; name: string;
          memo: string | null; debit_centavos: number; credit_centavos: number; running_centavos: number;
        }[]) ?? [];
      return {
        title: "General ledger",
        subtitle: `${params.from ?? "start"} to ${params.to ?? "today"}`,
        columns: [
          { label: "Date" }, { label: "Entry" }, { label: "Account" }, { label: "Memo" },
          { label: "Debit (₱)", numeric: true }, { label: "Credit (₱)", numeric: true },
          { label: "Balance (₱)", numeric: true },
        ],
        rows: rows.map((r) => ({
          cells: [
            r.entry_date, `#${r.entry_no}`, `${r.code} ${r.name}`, r.memo ?? "",
            r.debit_centavos ? c2p(r.debit_centavos) : null,
            r.credit_centavos ? c2p(r.credit_centavos) : null,
            c2p(r.running_centavos),
          ],
        })),
      };
    }
    case "cash-book": {
      const { data } = await supabase.rpc("report_cash_book", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
        p_cash_account_id: params.account || null,
      });
      const rows =
        (data as {
          entry_no: number; entry_date: string; memo: string | null; source_type: string;
          cash_in_centavos: number; cash_out_centavos: number; running_centavos: number;
        }[]) ?? [];
      return {
        title: "Cash book",
        subtitle: `${params.from ?? "start"} to ${params.to ?? "today"}`,
        columns: [
          { label: "Date" }, { label: "Entry" }, { label: "Memo" },
          { label: "In (₱)", numeric: true }, { label: "Out (₱)", numeric: true },
          { label: "Balance (₱)", numeric: true },
        ],
        rows: rows.map((r) => ({
          cells: [
            r.entry_date, `#${r.entry_no}`, r.memo ?? r.source_type,
            r.cash_in_centavos ? c2p(r.cash_in_centavos) : null,
            r.cash_out_centavos ? c2p(r.cash_out_centavos) : null,
            c2p(r.running_centavos),
          ],
        })),
      };
    }
    case "expenses": {
      const { data } = await supabase.rpc("report_expenses", {
        p_from: params.from ?? null,
        p_to: params.to ?? null,
      });
      const rows =
        (data as {
          expense_date: string; category: string; paid_from: string;
          amount_centavos: number; remarks: string | null;
        }[]) ?? [];
      const total = rows.reduce((s, r) => s + r.amount_centavos, 0);
      const out: ReportRow[] = rows.map((r) => ({
        cells: [r.expense_date, r.category, r.paid_from, c2p(r.amount_centavos), r.remarks ?? ""],
      }));
      out.push({ cells: ["Total", "", "", c2p(total), ""], bold: true });
      return {
        title: "Expense report",
        subtitle: `${params.from ?? "start"} to ${params.to ?? "today"}`,
        columns: [
          { label: "Date" }, { label: "Category" }, { label: "Paid from" },
          { label: "Amount (₱)", numeric: true }, { label: "Remarks" },
        ],
        rows: out,
      };
    }
    case "monthly": {
      const year = Number(params.year) || new Date().getFullYear();
      const { data } = await supabase.rpc("report_monthly_summary", { p_year: year });
      const rows =
        (data as {
          month: number; kg_bought: number; buy_cash_centavos: number; revenue_centavos: number;
          cogs_centavos: number; gross_profit_centavos: number; opex_centavos: number; net_profit_centavos: number;
        }[]) ?? [];
      return {
        title: "Monthly summary",
        subtitle: String(year),
        columns: [
          { label: "Month" }, { label: "Kg bought", numeric: true }, { label: "Buy cash (₱)", numeric: true },
          { label: "Revenue (₱)", numeric: true }, { label: "COGS (₱)", numeric: true },
          { label: "Gross (₱)", numeric: true }, { label: "Opex (₱)", numeric: true },
          { label: "Net (₱)", numeric: true },
        ],
        rows: rows.map((r) => ({
          cells: [
            MONTHS[r.month], Number(r.kg_bought), c2p(r.buy_cash_centavos), c2p(r.revenue_centavos),
            c2p(r.cogs_centavos), c2p(r.gross_profit_centavos), c2p(r.opex_centavos), c2p(r.net_profit_centavos),
          ],
        })),
      };
    }
  }
}
