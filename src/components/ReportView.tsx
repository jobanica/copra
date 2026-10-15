import { Card } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import type { ReportData, Cell } from "@/lib/reports";

function fmt(cell: Cell, numeric?: boolean): string {
  if (cell === null || cell === "") return "";
  if (numeric && typeof cell === "number") {
    return cell.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(cell);
}

export function ReportView({
  data,
  exportHref,
}: {
  data: ReportData;
  exportHref: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <a href={exportHref} className="btn-secondary">
          ⬇️ Excel
        </a>
        <PrintButton label="PDF" />
      </div>

      <Card className="overflow-x-auto">
        <div className="mb-3">
          <h2 className="text-lg font-bold">{data.title}</h2>
          {data.subtitle && <p className="text-sm text-gray-500">{data.subtitle}</p>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400">
              {data.columns.map((c, i) => (
                <th key={i} className={c.numeric ? "px-2 py-1 text-right" : "px-2 py-1"}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, ri) => (
              <tr key={ri} className={r.bold ? "border-b border-gray-100 font-semibold" : "border-b border-gray-50"}>
                {r.cells.map((cell, ci) => (
                  <td
                    key={ci}
                    className={data.columns[ci]?.numeric ? "px-2 py-1 text-right tabular-nums" : "px-2 py-1"}
                  >
                    {fmt(cell, data.columns[ci]?.numeric)}
                  </td>
                ))}
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={data.columns.length} className="px-2 py-4 text-center text-gray-400">
                  No data for this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
