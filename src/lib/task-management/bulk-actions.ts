import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export interface ExportColumn {
  key: string;
  label: string;
}

export const DELETE_CHUNK = 200;
export const UPDATE_CHUNK = 100;

export interface BulkUpdateRequest {
  ids: string[]; // task_management_raw.id (uuid)
  field: string;
  value: string | number | boolean | null;
}

export interface BulkUpdateResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: { id: string; message: string }[];
}

export async function applyBulkUpdate(req: BulkUpdateRequest): Promise<BulkUpdateResult> {
  const { ids, field, value } = req;
  const result: BulkUpdateResult = { attempted: ids.length, succeeded: 0, failed: 0, errors: [] };
  if (ids.length === 0) return result;

  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const slice = ids.slice(i, i + UPDATE_CHUNK);
    const payload: Record<string, unknown> = { [field]: value };
    const { data, error } = await (supabase as any)
      .from("task_management_raw")
      .update(payload)
      .in("id", slice)
      .select("id");
    if (error) {
      result.failed += slice.length;
      slice.forEach((id) => result.errors.push({ id, message: error.message }));
      continue;
    }
    const okCount = (data ?? []).length;
    result.succeeded += okCount;
    result.failed += slice.length - okCount;
  }
  return result;
}

export async function applyBulkHardDelete(ids: string[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const slice = ids.slice(i, i + DELETE_CHUNK);
    const { data, error } = await (supabase as any)
      .from("task_management_raw")
      .delete()
      .in("id", slice)
      .select("id");
    if (error) {
      failed += slice.length;
      continue;
    }
    deleted += (data ?? []).length;
  }
  return { deleted, failed };
}

export function exportRowsToXlsx({
  rows,
  columns,
  fileName,
}: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
  fileName: string;
}) {
  const header = columns.map((c) => c.label);
  const aoa: any[][] = [header];
  for (const r of rows) {
    aoa.push(columns.map((c) => formatCell(r[c.key])));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Task Management");
  XLSX.writeFile(wb, fileName);
}

export async function copyRowsAsTsv({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}): Promise<{ rowCount: number; colCount: number }> {
  const lines: string[] = [];
  lines.push(columns.map((c) => c.label).join("\t"));
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = formatCell(r[c.key]);
          return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
        })
        .join("\t"),
    );
  }
  await navigator.clipboard.writeText(lines.join("\n"));
  return { rowCount: rows.length, colCount: columns.length };
}

function formatCell(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}