import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { chunkArray } from "./bulk-edit";

export interface ExportColumn {
  key: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Hard Delete (cascade)
// ---------------------------------------------------------------------------

const CHILD_TABLES: { table: string; label: string }[] = [
  { table: "spare_part_comments", label: "Comments" },
  { table: "spare_part_status_history", label: "Status history" },
  { table: "spare_part_custom_fields", label: "Custom fields" },
];

export interface CascadePreview {
  spare_parts: number;
  [key: string]: number;
}

export async function previewBulkDelete(ids: string[]): Promise<CascadePreview> {
  const out: CascadePreview = { spare_parts: ids.length };
  if (!ids.length) return out;
  await Promise.all(
    CHILD_TABLES.map(async ({ table, label }) => {
      const { count } = await (supabase as any)
        .from(table)
        .select("doc_ref", { count: "exact", head: true })
        .in("doc_ref", ids);
      out[label] = count ?? 0;
    }),
  );
  return out;
}

export interface BulkDeleteResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

const DELETE_CHUNK = 200;

export async function applyBulkHardDelete(ids: string[]): Promise<BulkDeleteResult> {
  const out: BulkDeleteResult = { attempted: ids.length, succeeded: 0, failed: 0 };
  if (!ids.length) return out;

  for (const slice of chunkArray(ids, DELETE_CHUNK)) {
    // 자식 테이블 먼저 삭제
    for (const { table } of CHILD_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await (supabase as any).from(table).delete().in("doc_ref", slice);
    }
    // 본체 삭제
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await (supabase as any)
      .from("spare_parts_raw")
      .delete()
      .in("doc_ref", slice)
      .select("doc_ref");
    if (error) {
      out.failed += slice.length;
      continue;
    }
    const ok = (data ?? []).length;
    out.succeeded += ok;
    out.failed += slice.length - ok;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export (xlsx + TSV)
// ---------------------------------------------------------------------------

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function exportSelectedToXlsx(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
  fileName: string;
}) {
  const header = args.columns.map((c) => c.label);
  const aoa: unknown[][] = [header];
  for (const r of args.rows) {
    aoa.push(args.columns.map((c) => r[c.key] ?? ""));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Selected");
  XLSX.writeFile(wb, args.fileName);
}

export async function copyRowsAsTsv(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}): Promise<{ rowCount: number; colCount: number }> {
  const header = args.columns.map((c) => c.label).join("\t");
  const lines = [header];
  for (const r of args.rows) {
    lines.push(
      args.columns
        .map((c) => cellToString(r[c.key]).replace(/\t/g, " ").replace(/\r?\n/g, " "))
        .join("\t"),
    );
  }
  const tsv = lines.join("\n");
  await navigator.clipboard.writeText(tsv);
  return { rowCount: args.rows.length, colCount: args.columns.length };
}