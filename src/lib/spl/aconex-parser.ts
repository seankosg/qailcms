import * as XLSX from "xlsx";
import { isOcsDocumentNumber, normalizeSplNumber, splDisciplineTriple } from "./number-normalize";

/**
 * SPL Aconex Export(Docs 시트) 파서.
 * 실측(2026-08-08 PLOT C / PLOT D Export): 시트 `Docs`, 헤더 11행, 데이터 12행부터.
 *
 * 반영 대상은 두 칸뿐이다 — `Status`(Response Status) 와 `Date Modified`(Dar Response Date).
 * 매칭 키는 `Document No` (= spl_number). 대시 변종 정규화 후 비교한다.
 */

export type SplAconexCode = "A" | "B" | "C" | "D" | "UR";

/** Aconex 가 정하는 값이다. 표(테이블)로 관리하지 않는다. */
const STATUS_MAP: Record<string, SplAconexCode> = {
  "A - APPROVED": "A",
  "B - APPROVED WITH COMMENTS": "B",
  "C - REVISE AND RESUBMIT": "C",
  "D - REJECTED": "D",
  "FOR REVIEW": "UR",
};

export interface ParsedSplAconexRow {
  document_no: string;
  title: string | null;
  revision: string | null;
  status_raw: string | null;
  code: SplAconexCode | null;
  /** UR 은 회신 대기 — 날짜를 쓰지 않는다 */
  date_modified: string | null;
  excel_row: number;
}

export interface ParsedSplAconexFile {
  file_name: string;
  sheet_name: string;
  header_row: number;
  plot: "C" | "D";
  export_date: string;
  total_scanned: number;
  duplicates: number;
  ocs_excluded: number;
  no_status: number;
  rows: ParsedSplAconexRow[];
  status_counts: Array<{ status: string; count: number }>;
  unmapped_statuses: Array<{ status: string; count: number }>;
  discipline_counts: Array<{ triple: string; count: number }>;
}

function normText(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function mapSplAconexStatus(raw: string | null): SplAconexCode | null {
  if (!raw) return null;
  const key = normText(raw).replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-").replace(/\s*-\s*/g, " - ").trim();
  return STATUS_MAP[key] ?? null;
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

/* ── 1차 관문 — 파일명 ─────────────────────────────────────────────── */

export interface SplAconexFileNameMatch {
  plot: "C" | "D";
  /** yyyymmdd */
  export_date_raw: string;
  /** yyyy-mm-dd */
  export_date: string;
  time: string;
}

/** 접두사만 본다. PLOT 뒤 구분자는 공백/밑줄 모두, 끝에 복사본 접미사가 붙어도 통과. */
export function matchSplAconexFileName(fileName: string): SplAconexFileNameMatch | null {
  const base = fileName.replace(/\.[A-Za-z]+$/, "");
  const m = base.match(/^SPL[ _]PLOT[ _]([CD])[ _]ExportDocs(\d{8})_(\d{4})/i);
  if (!m) return null;
  const ymd = m[2];
  return {
    plot: m[1].toUpperCase() as "C" | "D",
    export_date_raw: ymd,
    export_date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    time: m[3],
  };
}

/* ── 2차 관문 — 내용(Document No 의 HDEC-XXX- 다수결) ───────────────── */

export interface SplAconexContentCheck {
  ok: boolean;
  total: number;
  lst: number;
  cer: number;
  other: number;
  counts: Array<{ triple: string; count: number }>;
}

export function checkSplAconexContent(documentNumbers: string[]): SplAconexContentCheck {
  const counts = new Map<string, number>();
  for (const n of documentNumbers) {
    const t = splDisciplineTriple(n) ?? "—";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = documentNumbers.length;
  const lst = counts.get("LST") ?? 0;
  const cer = counts.get("CER") ?? 0;
  return {
    ok: total > 0 && lst * 2 > total,
    total,
    lst,
    cer,
    other: total - lst - cer,
    counts: Array.from(counts.entries())
      .map(([triple, count]) => ({ triple, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* ── 파싱 ──────────────────────────────────────────────────────────── */

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

/** 관문 통과 여부와 무관하게 헤더/문서번호만 먼저 읽는다 (2차 관문 판정용). */
export async function readSplAconexHeaders(
  file: File,
): Promise<{ headers: string[]; sample: Record<string, unknown> }> {
  const wb = XLSX.read(await file.arrayBuffer());
  const sheetName = wb.SheetNames.find((n) => n.toUpperCase() === "DOCS") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const hdr = findHeaderRow(ws);
  if (!hdr) return { headers: [], sample: {} };
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const headers: string[] = [];
  const sample: Record<string, unknown> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = String(ws[XLSX.utils.encode_cell({ r: hdr.row, c })]?.v ?? "").trim();
    if (!h) continue;
    headers.push(h);
    sample[h] = ws[XLSX.utils.encode_cell({ r: hdr.row + 1, c })]?.v ?? "";
  }
  return { headers, sample };
}

/** 관문 통과 여부와 무관하게 문서번호만 먼저 읽는다 (2차 관문 판정용). */
export async function readSplAconexDocumentNumbers(file: File): Promise<string[]> {
  const wb = XLSX.read(await file.arrayBuffer());
  const sheetName = wb.SheetNames.find((n) => n.toUpperCase() === "DOCS") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const hdr = findHeaderRow(ws);
  if (!hdr) return [];
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const out: string[] = [];
  for (let r = hdr.row + 1; r <= range.e.r; r++) {
    const v = ws[XLSX.utils.encode_cell({ r, c: hdr.cols.document_no })]?.v;
    const n = normalizeSplNumber(v);
    if (n) out.push(n);
  }
  return out;
}

export async function parseSplAconexFile(file: File): Promise<ParsedSplAconexFile> {
  const nameMatch = matchSplAconexFileName(file.name);
  if (!nameMatch) throw new Error("Wrong file name");
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

  const byDoc = new Map<string, ParsedSplAconexRow>();
  const statusCounts = new Map<string, number>();
  const unmapped = new Map<string, number>();
  const disciplines = new Map<string, number>();
  let scanned = 0;
  let duplicates = 0;
  let ocsExcluded = 0;
  let noStatus = 0;

  for (let r = hdr.row + 1; r <= range.e.r; r++) {
    const docNo = normalizeSplNumber(get(r, "document_no"));
    if (!docNo) continue;
    scanned += 1;
    const triple = splDisciplineTriple(docNo) ?? "—";
    disciplines.set(triple, (disciplines.get(triple) ?? 0) + 1);
    // -OCS- 는 반영하지 않는다 (대시 변종 정규화 후 판정).
    if (isOcsDocumentNumber(docNo)) {
      ocsExcluded += 1;
      continue;
    }
    const statusRaw = get(r, "status") == null ? null : String(get(r, "status")).trim();
    if (statusRaw) statusCounts.set(statusRaw, (statusCounts.get(statusRaw) ?? 0) + 1);
    const code = mapSplAconexStatus(statusRaw);
    // No Status = 건너뛴다.
    if (!statusRaw || normText(statusRaw) === "NO STATUS") {
      noStatus += 1;
      continue;
    }
    if (!code) unmapped.set(statusRaw, (unmapped.get(statusRaw) ?? 0) + 1);

    const row: ParsedSplAconexRow = {
      document_no: docNo,
      title: get(r, "title") == null ? null : String(get(r, "title")).trim(),
      revision: get(r, "revision") == null ? null : String(get(r, "revision")).trim(),
      status_raw: statusRaw,
      code,
      date_modified: code === "UR" ? null : toIso(get(r, "date_modified")),
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
    plot: nameMatch.plot,
    export_date: nameMatch.export_date,
    total_scanned: scanned,
    duplicates,
    ocs_excluded: ocsExcluded,
    no_status: noStatus,
    rows: Array.from(byDoc.values()),
    status_counts: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    unmapped_statuses: Array.from(unmapped.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    discipline_counts: Array.from(disciplines.entries())
      .map(([triple, count]) => ({ triple, count }))
      .sort((a, b) => b.count - a.count),
  };
}
