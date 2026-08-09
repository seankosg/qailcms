import * as XLSX from "xlsx";

/**
 * WRT Aconex Export(Docs 시트) 파서.
 * 실측 파일(2026-08-08 PLOT-C / PLOT-D Export): 시트 `Docs`, 헤더 11행, 15 컬럼.
 *  File · Document No · Title · Revision · Status · Date Created · Revision Date ·
 *  Date Modified · Discipline · Created By · Related Items · Type · Size · Lock · Review Source
 *
 * - 매칭 키: `Document No` (= wrt_number 축)
 * - 회신일: `Date Modified` (재심사 문서는 최근 날짜가 온다 — 지시자 확정 규칙)
 * - 문서번호 중복 시: Date Modified 최신 우선(동률이면 시트 뒤 행 우선) — 결정적 규칙
 */

export type WrtAconexCode = "A" | "B" | "C" | "D" | "UR" | "CX" | "TM";

export type WrtAconexSemantic =
  | "APPROVED_A"
  | "APPROVED_B"
  | "REJECTED_C"
  | "REJECTED_D"
  | "UNDER_REVIEW"
  | "CANCELLED"
  | "TERMINATED"
  | "UNMAPPED";

export interface ParsedWrtAconexRow {
  document_no: string;
  title: string | null;
  revision: string | null;
  status_raw: string | null;
  code: WrtAconexCode | null;
  semantic: WrtAconexSemantic;
  date_modified: string | null;
  excel_row: number;
}

export interface ParsedWrtAconexFile {
  file_name: string;
  sheet_name: string;
  header_row: number;
  total_scanned: number;
  duplicates: number;
  rows: ParsedWrtAconexRow[];
  status_counts: Array<{ status: string; count: number }>;
  unmapped_statuses: Array<{ status: string; count: number }>;
}

const STATUS_MAP: Record<string, { code: WrtAconexCode; semantic: WrtAconexSemantic }> = {
  "A - APPROVED": { code: "A", semantic: "APPROVED_A" },
  "B - APPROVED WITH COMMENTS": { code: "B", semantic: "APPROVED_B" },
  "C - REVISE AND RESUBMIT": { code: "C", semantic: "REJECTED_C" },
  "D - REJECTED": { code: "D", semantic: "REJECTED_D" },
  "FOR REVIEW": { code: "UR", semantic: "UNDER_REVIEW" },
  "UNDER REVIEW": { code: "UR", semantic: "UNDER_REVIEW" },
  CANCELLED: { code: "CX", semantic: "CANCELLED" },
  CANCELED: { code: "CX", semantic: "CANCELLED" },
  TERMINATED: { code: "TM", semantic: "TERMINATED" },
};

function normText(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const p = XLSX.SSF?.parse_date_code?.(v);
    if (!p || !p.y || !p.m || !p.d) return null;
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    const da = Number(dmy[1]);
    const mo = Number(dmy[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const yy = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const dMonY = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,4})[\s\-/.]+(\d{2,4})/);
  if (dMonY) {
    const mo = MONTHS[dMonY[2].toLowerCase()];
    const da = Number(dMonY[1]);
    const yy = dMonY[3].length === 2 ? 2000 + Number(dMonY[3]) : Number(dMonY[3]);
    if (mo && da >= 1 && da <= 31) return `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  return null;
}

export function mapWrtAconexStatus(raw: string | null): {
  code: WrtAconexCode | null;
  semantic: WrtAconexSemantic;
} {
  if (!raw) return { code: null, semantic: "UNMAPPED" };
  const key = normText(raw).replace(/[–—]/g, "-").replace(/\s*-\s*/g, " - ").trim();
  const hit = STATUS_MAP[key] ?? STATUS_MAP[normText(raw)];
  if (hit) return hit;
  const prefix = key.match(/^([A-D])\s*-\s*/);
  if (prefix) {
    const c = prefix[1] as WrtAconexCode;
    const sem: WrtAconexSemantic =
      c === "A" ? "APPROVED_A" : c === "B" ? "APPROVED_B" : c === "C" ? "REJECTED_C" : "REJECTED_D";
    return { code: c, semantic: sem };
  }
  // For Information / For Action 등 매핑 없는 상태 — 어떤 필드도 쓰지 않고 건수만 센다.
  return { code: null, semantic: "UNMAPPED" };
}

function findHeaderRow(ws: XLSX.WorkSheet): { row: number; cols: Record<string, number> } | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const targets: Record<string, string[]> = {
    document_no: ["DOCUMENT NO", "DOCUMENT NO.", "DOC NO", "DOCUMENT NUMBER"],
    title: ["TITLE"],
    revision: ["REVISION", "REV"],
    status: ["STATUS"],
    date_modified: ["DATE MODIFIED", "MODIFIED DATE"],
  };
  const scanEnd = Math.min(range.s.r + 39, range.e.r);
  for (let r = range.s.r; r <= scanEnd; r++) {
    const found: Record<string, number> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = normText(ws[XLSX.utils.encode_cell({ r, c })]?.v);
      if (!v) continue;
      for (const [key, aliases] of Object.entries(targets)) {
        if (found[key] != null) continue;
        if (aliases.includes(v)) found[key] = c;
      }
    }
    if (found.document_no != null && found.status != null) return { row: r, cols: found };
  }
  return null;
}

export async function parseWrtAconexFile(file: File): Promise<ParsedWrtAconexFile> {
  const wb = XLSX.read(await file.arrayBuffer());
  const sheetName = wb.SheetNames.find((n) => n.toUpperCase() === "DOCS") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const hdr = findHeaderRow(ws);
  if (!hdr) throw new Error("Aconex export header not found (Document No + Status required).");
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const get = (r: number, key: string): unknown => {
    const c = hdr.cols[key];
    if (c == null) return null;
    return ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;
  };

  const byDoc = new Map<string, ParsedWrtAconexRow>();
  const statusCounts = new Map<string, number>();
  const unmapped = new Map<string, number>();
  let scanned = 0;
  let duplicates = 0;

  for (let r = hdr.row + 1; r <= range.e.r; r++) {
    const docNo = String(get(r, "document_no") ?? "").trim();
    if (!docNo) continue;
    scanned += 1;
    const statusRaw = get(r, "status") == null ? null : String(get(r, "status")).trim();
    const { code, semantic } = mapWrtAconexStatus(statusRaw);
    if (statusRaw) statusCounts.set(statusRaw, (statusCounts.get(statusRaw) ?? 0) + 1);
    if (semantic === "UNMAPPED" && statusRaw) unmapped.set(statusRaw, (unmapped.get(statusRaw) ?? 0) + 1);
    const row: ParsedWrtAconexRow = {
      document_no: docNo,
      title: get(r, "title") == null ? null : String(get(r, "title")).trim(),
      revision: get(r, "revision") == null ? null : String(get(r, "revision")).trim(),
      status_raw: statusRaw,
      code,
      semantic,
      date_modified: toIso(get(r, "date_modified")),
      excel_row: r + 1,
    };
    const prev = byDoc.get(docNo);
    if (!prev) {
      byDoc.set(docNo, row);
      continue;
    }
    duplicates += 1;
    // 결정적 규칙: Date Modified 최신 우선, 동률이면 뒤 행 우선.
    if ((row.date_modified ?? "") >= (prev.date_modified ?? "")) byDoc.set(docNo, row);
  }

  return {
    file_name: file.name,
    sheet_name: sheetName,
    header_row: hdr.row + 1,
    total_scanned: scanned,
    duplicates,
    rows: Array.from(byDoc.values()),
    status_counts: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    unmapped_statuses: Array.from(unmapped.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Fingerprint — WRT HDEC 왕복 양식과 Aconex Export 를 구분한다. */
export function isWrtAconexHeaderSet(headers: string[]): boolean {
  const set = new Set(headers.map((h) => normText(h)));
  return set.has("DOCUMENT NO") && set.has("STATUS") && set.has("DATE MODIFIED");
}
