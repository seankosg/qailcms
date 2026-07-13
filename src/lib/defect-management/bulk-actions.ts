import { buildStyledWorkbook, saveStyledWorkbook, type ColumnKind } from "@/lib/excel/styled-workbook";
import { DEFECT_COLUMNS } from "./columns";

export interface ExportColumn {
  key: string;
  label: string;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function exportSelectedToXlsx(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
  fileName: string;
}) {
  const styled = args.columns.map((column) => {
    const def = DEFECT_COLUMNS.find((d) => d.key === column.key);
    let kind: ColumnKind = "text";
    if (def) {
      if (def.type === "date" || def.type === "datetime") kind = "date";
      else if (def.type === "number" || def.type === "percent") kind = "number";
      else if (def.type === "boolean") kind = "boolean";
    }
    return { key: column.key, label: column.label, kind, widthPx: def?.width };
  });

  const wb = buildStyledWorkbook({
    title: "Snag List — Raw Data (Selected Rows)",
    columns: styled,
    rows: args.rows,
    sheetName: "Selected",
    freezeCols: 1,
  });
  saveStyledWorkbook(wb, args.fileName);
}

export async function copyRowsAsTsv(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}): Promise<{ rowCount: number; colCount: number }> {
  const lines = [args.columns.map((column) => column.label).join("\t")];
  for (const row of args.rows) {
    lines.push(
      args.columns
        .map((column) => cellToString(row[column.key]).replace(/\t/g, " ").replace(/\r?\n/g, " "))
        .join("\t"),
    );
  }
  await navigator.clipboard.writeText(lines.join("\n"));
  return { rowCount: args.rows.length, colCount: args.columns.length };
}