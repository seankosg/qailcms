import { dohaStampCompact } from "@/lib/time/doha";
import JSZip from "jszip";
import { SPARE_PART_COLUMNS, type SparePartColumnDef } from "./columns";
import {
  buildStyledWorkbook,
  saveStyledWorkbook,
  styledWorkbookToBuffer,
  type StyledColumn,
  type ColumnKind,
} from "@/lib/excel/styled-workbook";

export type ExportGroupBy = "plot" | "supplier" | "manufacturer";
export type ExportFormat = "view" | "reimport";

const ZIP_THRESHOLD = 7;

interface RowLike {
  [k: string]: unknown;
}

function kindOf(def: SparePartColumnDef | undefined): ColumnKind {
  if (!def) return "text";
  if (def.type === "date") return "date";
  if (def.type === "number" || def.type === "cost" || def.type === "progress") return "number";
  if (def.type === "boolean") return "boolean";
  return "text";
}

function styledColumns(keys: string[], format: ExportFormat): StyledColumn[] {
  return keys.map((k) => {
    const def = SPARE_PART_COLUMNS.find((c) => c.key === k);
    return {
      key: k,
      label: format === "reimport" ? k : (def?.label ?? k),
      kind: kindOf(def),
      widthPx: def?.width,
    };
  });
}

function buildWb(rows: RowLike[], visibleKeys: string[], format: ExportFormat, note?: string) {
  const keys = format === "reimport" ? SPARE_PART_COLUMNS.map((c) => c.key) : visibleKeys;
  return buildStyledWorkbook({
    title: `Spare Part Raw Data  (${format === "reimport" ? "Re-import" : "View"})`,
    columns: styledColumns(keys, format),
    rows: rows as Record<string, unknown>[],
    sheetName: "Raw Data",
    freezeCols: 1,
    meta: { note },
  });
}

function safeName(s: string): string {
  return String(s || "unknown").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function timestamp(): string {
  // Doha (Asia/Qatar) — YYYYMMDD_HHmm
  const s = dohaStampCompact();
  return `${s.slice(0, 8)}_${s.slice(8)}`;
}

export function exportSingle(rows: RowLike[], visibleKeys: string[], format: ExportFormat) {
  const wb = buildWb(rows, visibleKeys, format);
  saveStyledWorkbook(wb, `spare-part_raw_${format}_${timestamp()}.xlsx`);
}

export async function exportGrouped(
  rows: RowLike[],
  visibleKeys: string[],
  format: ExportFormat,
  groupBy: ExportGroupBy,
) {
  const groups = new Map<string, RowLike[]>();
  for (const r of rows) {
    const key = String(r[groupBy] ?? "").trim() || "(Empty)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (entries.length >= ZIP_THRESHOLD) {
    const zip = new JSZip();
    for (const [name, groupRows] of entries) {
      const wb = buildWb(groupRows, visibleKeys, format, `${groupBy}: ${name}`);
      const buf = await styledWorkbookToBuffer(wb);
      zip.file(`${safeName(name)}.xlsx`, buf);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spare-part_by-${groupBy}_${format}_${timestamp()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } else {
    for (const [name, groupRows] of entries) {
      const wb = buildWb(groupRows, visibleKeys, format, `${groupBy}: ${name}`);
      saveStyledWorkbook(wb, `spare-part_${groupBy}-${safeName(name)}_${format}_${timestamp()}.xlsx`);
    }
  }
}