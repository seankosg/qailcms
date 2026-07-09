import * as XLSX from "xlsx";
import JSZip from "jszip";
import { SPARE_PART_COLUMNS } from "./columns";

export type ExportGroupBy = "plot" | "supplier" | "manufacturer";
export type ExportFormat = "view" | "reimport";

const ZIP_THRESHOLD = 7;

interface RowLike {
  [k: string]: unknown;
}

function buildSheet(rows: RowLike[], visibleKeys: string[], format: ExportFormat) {
  const keys = format === "reimport" ? SPARE_PART_COLUMNS.map((c) => c.key) : visibleKeys;
  const header = keys.map((k) => {
    if (format === "reimport") return k;
    return SPARE_PART_COLUMNS.find((c) => c.key === k)?.label ?? k;
  });
  const aoa: any[][] = [header];
  for (const r of rows) {
    aoa.push(keys.map((k) => (r[k] ?? "") as any));
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function safeName(s: string): string {
  return String(s || "unknown").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function exportSingle(rows: RowLike[], visibleKeys: string[], format: ExportFormat) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(rows, visibleKeys, format), "Raw Data");
  saveWorkbook(wb, `spare-part_raw_${format}_${timestamp()}.xlsx`);
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
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildSheet(groupRows, visibleKeys, format), "Raw Data");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
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
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildSheet(groupRows, visibleKeys, format), "Raw Data");
      saveWorkbook(wb, `spare-part_${groupBy}-${safeName(name)}_${format}_${timestamp()}.xlsx`);
    }
  }
}