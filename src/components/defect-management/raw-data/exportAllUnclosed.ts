import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

const CHUNK = 2000;

export async function exportAllUnclosed(onProgress?: (fetched: number, total: number) => void): Promise<{ count: number }> {
  const all: Record<string, any>[] = [];
  let offset = 0;
  let total = Infinity;
  const sort = [{ column: "source_issue_no", desc: false }];
  while (offset < total) {
    const { data, error } = await (supabase as any).rpc("defect_items_search", {
      _status_group: "unclosed",
      _include_inactive: false,
      _q: null,
      _filters: [],
      _sort: sort,
      _offset: offset,
      _limit: CHUNK,
    });
    if (error) throw new Error(error.message);
    const arr = (data ?? []) as { rows: any; total_count: number | string }[];
    if (arr.length === 0) break;
    total = Number(arr[0]?.total_count ?? all.length);
    for (const r of arr) all.push(r.rows as Record<string, any>);
    offset += arr.length;
    onProgress?.(all.length, total);
    if (arr.length < CHUNK) break;
  }

  const headers = collectHeaders(all);
  const aoa: any[][] = [headers];
  for (const row of all) {
    aoa.push(headers.map((h) => normalizeCell(row[h])));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Unclosed");
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  XLSX.writeFile(wb, `snag-raw-data-unclosed-${ts}.xlsx`);
  return { count: all.length };
}

function collectHeaders(rows: Record<string, any>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const priority = [
    "id", "source_issue_no", "team", "status_raw", "status_group", "is_active", "is_critical",
    "data_date", "priority", "hdec_verification", "location_raw", "subcontractor_name",
    "category", "defect_type", "description", "assigned_to",
  ];
  for (const k of priority) { if (!seen.has(k)) { seen.add(k); order.push(k); } }
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
  }
  return order;
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}