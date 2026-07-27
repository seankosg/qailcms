import { supabase } from "@/integrations/supabase/client";
import { dohaStampCompact } from "@/lib/time/doha";
import { streamXlsxExport } from "@/lib/excel/stream-export";
import {
  buildDefectHeaderBlock,
  DEFECT_DATE_FIELDS,
  DEFECT_DATETIME_FIELDS,
} from "@/lib/defect-management/export-meta";

const CHUNK = 1000;
const PRIORITY = [
  "id", "source_issue_no", "team", "status_raw", "status_group", "is_active", "is_critical",
  "data_date", "priority", "hdec_verification", "location_raw", "subcontractor_name",
  "category", "defect_type", "description", "assigned_to",
];

async function fetchPage(offset: number, limit: number) {
  const { data, error } = await (supabase as any).rpc("defect_items_search", {
    _status_group: "unclosed",
    _include_inactive: false,
    _q: null,
    _filters: [],
    _sort: [{ column: "source_issue_no", desc: false }],
    _offset: offset,
    _limit: limit,
  });
  if (error) throw new Error(error.message);
  const arr = (data ?? []) as { rows: any; total_count: number | string }[];
  const rows = arr.map((r) => r.rows as Record<string, any>);
  const total = Number(arr[0]?.total_count ?? rows.length);
  return { rows, total };
}

export async function exportAllUnclosed(
  onProgress?: (fetched: number, total: number) => void,
): Promise<{ count: number }> {
  // First page → derive column list (priority ∪ discovered keys)
  const first = await fetchPage(0, CHUNK);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const k of PRIORITY) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  for (const r of first.rows) for (const k of Object.keys(r)) {
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  const columns = keys.map((k) => ({ key: k, label: k }));
  onProgress?.(first.rows.length, first.total);

  const header = buildDefectHeaderBlock({
    format: "view",
    meta: { userName: "system", userType: "" },
    sourceLabel: "Snag Raw Data → Tab: unclosed · Full export",
    search: "",
    filterSummary: "(none)",
    sortSummary: "source_issue_no ↑",
  });

  // Stream: reuse first page, then continue from CHUNK
  let served = false;
  return streamXlsxExport({
    filename: `CMS_SM_raw-unclosed_${dohaStampCompact()}.xlsx`,
    sheetName: "Unclosed",
    columns,
    chunkSize: CHUNK,
    header: { title: header.title, metaRows: header.metaRows, freezeCols: 3 },
    dateFields: DEFECT_DATE_FIELDS,
    datetimeFields: DEFECT_DATETIME_FIELDS,
    fetchPage: async (offset, limit) => {
      if (!served) { served = true; return first; }
      return fetchPage(offset, limit);
    },
    onProgress,
  });
}