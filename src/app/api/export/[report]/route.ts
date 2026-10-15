import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isOwner } from "@/lib/auth";
import { getReportData, REPORTS, type ReportKey } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  if (!REPORTS.some((r) => r.key === report)) {
    return new Response("Unknown report", { status: 404 });
  }

  const session = await getSessionProfile();
  if (!session || !isOwner(session.profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const supabase = await createClient();
  const data = await getReportData(supabase, report as ReportKey, {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    as_of: sp.get("as_of") ?? undefined,
    account: sp.get("account") ?? undefined,
    year: sp.get("year") ?? undefined,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "CopraBooks";
  const ws = wb.addWorksheet(data.title.slice(0, 28));

  const titleRow = ws.addRow([data.title]);
  titleRow.font = { bold: true, size: 14 };
  if (data.subtitle) ws.addRow([data.subtitle]).font = { italic: true, color: { argb: "FF888888" } };
  ws.addRow([]);

  const header = ws.addRow(data.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } };
  });

  for (const r of data.rows) {
    const row = ws.addRow(r.cells.map((c) => (c === null ? "" : c)));
    if (r.bold) row.font = { bold: true };
  }

  // Formatting + widths.
  data.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.numeric ? 16 : 24;
    if (c.numeric) {
      col.numFmt = "#,##0.00";
      col.alignment = { horizontal: "right" };
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `coprabooks-${report}.xlsx`;
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
