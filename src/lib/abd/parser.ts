import * as XLSX from "xlsx";
import { dohaWallToUtcIso, toDohaDateKey, dohaDateOnly } from "@/lib/time/doha";
import type { AbdTeam } from "./columns";
import type { TeamOption } from "@/lib/team/team-master";
import { detectTeamFromText } from "@/lib/team/team-master";

export interface ParsedAbdRow {
  sl_no: number | null;
  plot: "C" | "D" | null;
  dis: string | null;
  service: string | null;
  doc_ax: string | null;
  doc_axx: string | null;
  doc_nn1: string | null;
  doc_n: string | null;
  doc_nn2: string | null;
  document_title: string | null;
  abd_number: string;
  abd_ocs_no: string | null;
  batch_no: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  latest_rev: string | null;
  latest_status: string | null;
  approval_date: string | null;
  r1_drafting_plan: string | null;   r1_drafting_actual: string | null;
  r1_submission_plan: string | null; r1_submission_actual: string | null;
  r1_dar_plan: string | null;        r1_dar_actual: string | null;
  r2_drafting_plan: string | null;   r2_drafting_actual: string | null;
  r2_submission_plan: string | null; r2_submission_actual: string | null;
  r2_dar_plan: string | null;        r2_dar_actual: string | null;
  r3_drafting_plan: string | null;   r3_drafting_actual: string | null;
  r3_submission_plan: string | null; r3_submission_actual: string | null;
  r3_dar_plan: string | null;        r3_dar_actual: string | null;
  raw_payload: Record<string, any>;
  /** Excel row index (1-based, matches Excel's row numbering) */
  excel_row: number;
  /** Sheet name this row came from */
  sheet_name: string;
}

export interface ParsedSheetResult {
  sheet_name: string;
  team: string | null;
  plot: "C" | "D" | null;
  rows: ParsedAbdRow[];
  skipped_no_key: number;
  warnings: string[];
}

export interface ParsedFileResult {
  file_name: string;
  team_from_filename: string | null;
  sheets: ParsedSheetResult[];
  ignored_sheets: string[];
  /** ABD_NUMBER 가 파일 내에서 2회 이상 등장하는 그룹들 */
  duplicates_in_file: Array<{
    abd_number: string;
    occurrences: Array<{
      sheet_name: string;
      excel_row: number;
      sl_no: number | null;
      document_title: string | null;
    }>;
  }>;
}

const STAGE_TO_KEY: Record<string, "drafting" | "submission" | "dar"> = {
  "DRAFTING": "drafting",
  "SUBMISSION": "submission",
  "DAR RESPONSE": "dar",
  "DAR": "dar",
};

function normText(v: any): string {
  return String(v ?? "").trim().toUpperCase();
}

function cleanCell(v: any): any {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "#N/A" || t === "N/A" || t === "-") return null;
    return t;
  }
  return v;
}

function toIsoDate(v: any): string | null {
  try {
    if (v == null || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      // xlsx `cellDates:true` returns a Date built from the sheet's wall-clock
      // components as LOCAL time. Read local Y/M/D directly; never touch UTC
      // arithmetic here or the day will shift by the browser TZ offset.
      return dohaDateOnly(v);
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v <= 0) return null;
      const parsed = XLSX.SSF?.parse_date_code?.(v);
      if (!parsed) return null;
      const { y, m, d } = parsed;
      if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    const s = String(v).trim();
    if (!s) return null;
    const upper = s.toUpperCase();
    if (
      upper === "TBD" || upper === "TBA" || upper === "PENDING" ||
      upper === "N/A" || upper === "NA" || upper === "#N/A" ||
      upper === "-" || upper === "--" || upper === "0"
    ) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const mo = Number(iso[2]);
      const da = Number(iso[3]);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (dmy) {
      const da = Number(dmy[1]);
      const mo = Number(dmy[2]);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      const yy = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
      if (yy < 1900 || yy > 2999) return null;
      return `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
    return toDohaDateKey(s) || null;
  } catch {
    return null;
  }
}

/**
 * 파일명에서 team 코드를 감지.
 * teamOptions가 주어지면 team_master의 code/aliases 기반으로 동적 매칭,
 * 없으면 legacy 하드코딩(MECH/ELEC/ARCH)에 fallback.
 */
export function detectTeamFromFilename(
  name: string,
  teamOptions?: TeamOption[],
): string | null {
  if (teamOptions && teamOptions.length > 0) {
    const match = detectTeamFromText(name, teamOptions);
    return match?.code ?? null;
  }
  const n = name.toUpperCase();
  if (n.includes("MECH") || n.includes("설비") || n.includes("MECHANICAL")) return "MECH";
  if (n.includes("ELEC") || n.includes("전기") || n.includes("ELECTRICAL")) return "ELEC";
  if (n.includes("ARCH") || n.includes("건축") || n.includes("ARCHITECT")) return "ARCH";
  return null;
}

function detectPlotFromSheet(name: string): "C" | "D" | null {
  const n = name.toUpperCase();
  if (/PLOT\s*D/.test(n) || /PLOT\s*4/.test(n)) return "D";
  if (/PLOT\s*C/.test(n) || /PLOT\s*3/.test(n)) return "C";
  return null;
}

function isImportableSheet(name: string): boolean {
  const n = name.toUpperCase();
  if (n.includes("CHART")) return false;
  if (n.includes("SUBCON")) return false;
  if (/^SHEET\d*$/i.test(name)) return false;
  return true;
}

/** ABD_NUMBER 파싱: 9207-BP12D-HDEC-ABD-PB-NS-B04-51106 */
function parseAbdNumber(abd: string): {
  plot: "C" | "D" | null;
  dis: string | null;
  doc_ax: string | null;
  doc_axx: string | null;
  doc_nn1: string | null;
  doc_n: string | null;
  doc_nn2: string | null;
} {
  const parts = abd.split("-").map((p) => p.trim());
  // Expected: [project, plotcode, HDEC, ABD, DIS, AX, AXX, NNNNNN]
  if (parts.length < 8) {
    return { plot: null, dis: null, doc_ax: null, doc_axx: null, doc_nn1: null, doc_n: null, doc_nn2: null };
  }
  const [, plotCode, , , dis, ax, axx, tail] = parts;
  const plot: "C" | "D" | null = plotCode?.toUpperCase().endsWith("C") ? "C" : plotCode?.toUpperCase().endsWith("D") ? "D" : null;
  // tail e.g. "51106" → NN1=51, N=1, NN2=06 or similar. Original headers: NN | N | NN
  // Based on sample data: 51106 → NN1=51, N=1, NN2=06? Actually raw was 51, 1, 06 for NN|N|NN.
  // Approach: split tail (5 chars typical) as first 2 + 1 + last 2. Fallback to slicing.
  let nn1: string | null = null, n: string | null = null, nn2: string | null = null;
  if (tail && tail.length >= 3) {
    if (tail.length === 5) {
      nn1 = tail.slice(0, 2);
      n = tail.slice(2, 3);
      nn2 = tail.slice(3, 5);
    } else if (tail.length === 4) {
      nn1 = tail.slice(0, 1);
      n = tail.slice(1, 2);
      nn2 = tail.slice(2, 4);
    } else {
      nn1 = tail.slice(0, Math.max(1, tail.length - 3));
      n = tail.slice(-3, -2);
      nn2 = tail.slice(-2);
    }
  }
  return { plot, dis: dis || null, doc_ax: ax || null, doc_axx: axx || null, doc_nn1: nn1, doc_n: n, doc_nn2: nn2 };
}

interface HeaderMap {
  headerRow: number; // 0-based row index of the row with Sl.No/DIS/ABD NUMBER labels
  colIndex: Record<string, number>; // canonical field key -> column index
}

function findHeader(ws: XLSX.WorkSheet): HeaderMap | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  // ABD NUMBER 컬럼의 표시용 별칭 (view-friendly export 대응)
  const isAbdNumberLabel = (v: string): boolean => {
    const n = v.replace(/[._\-\s]+/g, " ").trim();
    if (!n) return false;
    return (
      n === "ABD NUMBER" ||
      n === "ABD NO" ||
      n === "ABD NUM" ||
      n === "ABD DOC NO" ||
      n === "ABD DOCUMENT NO" ||
      n === "ABD DOCUMENT NUMBER" ||
      n === "DOCUMENT NO" ||
      n === "DOC NO"
    );
  };
  // Find row 0..8 containing "Sl.No" and "ABD NUMBER"
  let anchorRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 29, range.e.r); r++) {
    let hasSlNo = false, hasAbd = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const v = normText(cell?.v);
      if (v === "SL.NO" || v === "SL NO") hasSlNo = true;
      if (isAbdNumberLabel(v)) hasAbd = true;
    }
    if (hasSlNo && hasAbd) { anchorRow = r; break; }
  }
  if (anchorRow < 0) return null;

  const roundRow = anchorRow - 2;
  const stageRow = anchorRow - 1;
  const colIndex: Record<string, number> = {};

  // Fill forward for merged cells (row-level)
  const roundBands: string[] = [];
  const stageBands: string[] = [];
  {
    let lastR = "";
    let lastS = "";
    for (let c = range.s.c; c <= range.e.c; c++) {
      const rCell = roundRow >= 0 ? ws[XLSX.utils.encode_cell({ r: roundRow, c })] : undefined;
      const sCell = stageRow >= 0 ? ws[XLSX.utils.encode_cell({ r: stageRow, c })] : undefined;
      const rv = normText(rCell?.v);
      const sv = normText(sCell?.v);
      if (rv) lastR = rv; roundBands.push(lastR);
      if (sv) lastS = sv; stageBands.push(lastS);
    }
  }
  // Merges also help
  const merges = ws["!merges"] ?? [];
  for (const m of merges) {
    if (m.s.r === roundRow) {
      const rCell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
      const v = normText(rCell?.v);
      if (v) for (let c = m.s.c; c <= m.e.c; c++) roundBands[c - range.s.c] = v;
    }
    if (m.s.r === stageRow) {
      const sCell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
      const v = normText(sCell?.v);
      if (v) for (let c = m.s.c; c <= m.e.c; c++) stageBands[c - range.s.c] = v;
    }
  }

  // Now walk anchor row labels
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: anchorRow, c })];
    const label = normText(cell?.v);
    const roundBand = roundBands[c - range.s.c] || "";
    const stageBand = stageBands[c - range.s.c] || "";

    if (label === "SL.NO" || label === "SL NO") colIndex.sl_no = c;
    else if (label === "DIS") colIndex.dis = c;
    else if (label === "SERVICE") colIndex.service = c;
    else if (label === "AX") colIndex.doc_ax = c;
    else if (label === "AXX") colIndex.doc_axx = c;
    else if (label === "NN" && !("doc_nn1" in colIndex)) colIndex.doc_nn1 = c;
    else if (label === "N") colIndex.doc_n = c;
    else if (label === "NN") colIndex.doc_nn2 = c;
    else if (label === "DOCUMENT TITLE") colIndex.document_title = c;
    else if (isAbdNumberLabel(label) && !("abd_number" in colIndex)) colIndex.abd_number = c;
    else if (label === "ABD OCS NO." || label === "ABD OCS NO" || label === "OCS NO.") colIndex.abd_ocs_no = c;
    else if (label === "BATCH NO." || label === "BATCH NO" || label === "BATCH NUMBER" || label === "BATCH") colIndex.batch_no = c;
    else if (
      label === "HDEC PIC" || label === "HDEC_PIC" ||
      label === "담당(한글)" || label === "담당 (한글)" || label === "담당(국문)" || label === "담당"
    ) {
      colIndex.hdec_pic_name = c;
    }
    else if (
      label === "HDEC ENG" || label === "HDEC_ENG" ||
      label === "담당(영문)" || label === "담당 (영문)" ||
      label === "PIC(ENG)" || label === "PIC (ENG)" || label === "PIC"
    ) {
      // 레거시 단일 "PIC" 컬럼은 ENG 슬롯으로 매핑 (한글이면 아래 자동 분배 로직으로 hdec_pic_name 로 이동)
      colIndex.hdec_eng_name = c;
    }
    else if (label === "REV") colIndex.latest_rev = c;
    else if (label === "STATUS") colIndex.latest_status = c;
    else if (label === "APPOVAL" || label === "APPROVAL" || label === "APPROVAL DATE") colIndex.approval_date = c;
    else if (label === "PLAN" || label === "ACTUAL") {
      const roundMatch = /ROUND\s*(\d)/.exec(roundBand);
      const roundIdx = roundMatch ? Number(roundMatch[1]) : null;
      const stageKey = STAGE_TO_KEY[stageBand];
      if (roundIdx && stageKey) {
        const which = label === "PLAN" ? "plan" : "actual";
        colIndex[`r${roundIdx}_${stageKey}_${which}`] = c;
      }
    }
  }

  return { headerRow: anchorRow, colIndex };
}

export async function parseAbdFile(
  file: File,
  teamOverride?: string | null,
  teamOptions?: TeamOption[],
): Promise<ParsedFileResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const teamFromFilename = teamOverride ?? detectTeamFromFilename(file.name, teamOptions);
  const result: ParsedFileResult = {
    file_name: file.name,
    team_from_filename: teamFromFilename,
    sheets: [],
    ignored_sheets: [],
    duplicates_in_file: [],
  };

  for (const name of wb.SheetNames) {
    if (!isImportableSheet(name)) { result.ignored_sheets.push(name); continue; }
    const ws = wb.Sheets[name];
    const hdr = findHeader(ws);
    if (!hdr) { result.ignored_sheets.push(name); continue; }

    const rows: ParsedAbdRow[] = [];
    const ref = ws["!ref"]!;
    const range = XLSX.utils.decode_range(ref);
    let skippedNoKey = 0;
    const plotFromSheet = detectPlotFromSheet(name);

    for (let r = hdr.headerRow + 1; r <= range.e.r; r++) {
      const getVal = (key: string): any => {
        const c = hdr.colIndex[key];
        if (c == null) return null;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        return cleanCell(cell?.v);
      };
      const abdRaw = getVal("abd_number");
      const abd = abdRaw ? String(abdRaw).trim() : "";
      if (!abd) { skippedNoKey++; continue; }

      // Source values
      // 엑셀 원본 셀값을 그대로 사용 (ABD_NUMBER 재파싱으로 덮어쓰지 않음)
      const src_dis = getVal("dis") != null ? String(getVal("dis")).trim() || null : null;
      const src_ax = getVal("doc_ax") != null ? String(getVal("doc_ax")).trim() || null : null;
      const src_axx = getVal("doc_axx") != null ? String(getVal("doc_axx")).trim() || null : null;
      const src_nn1 = getVal("doc_nn1") != null ? String(getVal("doc_nn1")).trim() || null : null;
      const src_n = getVal("doc_n") != null ? String(getVal("doc_n")).trim() || null : null;
      const src_nn2 = getVal("doc_nn2") != null ? String(getVal("doc_nn2")).trim() || null : null;
      const plot = plotFromSheet;

      const raw_payload: Record<string, any> = {};
      for (const key of Object.keys(hdr.colIndex)) raw_payload[key] = getVal(key);

      // HDEC PIC / HDEC ENG 값 결정: 단일 컬럼만 있을 때 한글이면 PIC, 아니면 ENG 로 분배
      const picCol = hdr.colIndex.hdec_pic_name;
      const engCol = hdr.colIndex.hdec_eng_name;
      const singlePicColumn = picCol != null && picCol === engCol;
      const rawPic = picCol != null ? getVal("hdec_pic_name") : null;
      const rawEng = !singlePicColumn && engCol != null ? getVal("hdec_eng_name") : null;
      let hdec_pic_name: string | null = null;
      let hdec_eng_name: string | null = null;
      if (singlePicColumn) {
        const v = rawPic != null ? String(rawPic).trim() : null;
        if (v) {
          if (/[\uAC00-\uD7A3]/.test(v)) hdec_pic_name = v; else hdec_eng_name = v;
        }
      } else {
        hdec_pic_name = rawPic != null ? String(rawPic).trim() || null : null;
        hdec_eng_name = rawEng != null ? String(rawEng).trim() || null : null;
      }

      const row: ParsedAbdRow = {
        sl_no: getVal("sl_no") != null ? Number(getVal("sl_no")) : null,
        plot,
        dis: src_dis,
        service: getVal("service") ? String(getVal("service")) : null,
        doc_ax: src_ax,
        doc_axx: src_axx,
        doc_nn1: src_nn1,
        doc_n: src_n,
        doc_nn2: src_nn2,
        document_title: getVal("document_title") ? String(getVal("document_title")) : null,
        abd_number: abd,
        abd_ocs_no: getVal("abd_ocs_no") ? String(getVal("abd_ocs_no")).trim() : null,
        batch_no: getVal("batch_no") ? String(getVal("batch_no")).trim() : null,
        hdec_pic_name,
        hdec_eng_name,
        latest_rev: getVal("latest_rev") ? String(getVal("latest_rev")) : null,
        latest_status: getVal("latest_status") ? String(getVal("latest_status")).toUpperCase() : null,
        approval_date: toIsoDate(getVal("approval_date")),
        r1_drafting_plan: toIsoDate(getVal("r1_drafting_plan")),
        r1_drafting_actual: toIsoDate(getVal("r1_drafting_actual")),
        r1_submission_plan: toIsoDate(getVal("r1_submission_plan")),
        r1_submission_actual: toIsoDate(getVal("r1_submission_actual")),
        r1_dar_plan: toIsoDate(getVal("r1_dar_plan")),
        r1_dar_actual: toIsoDate(getVal("r1_dar_actual")),
        r2_drafting_plan: toIsoDate(getVal("r2_drafting_plan")),
        r2_drafting_actual: toIsoDate(getVal("r2_drafting_actual")),
        r2_submission_plan: toIsoDate(getVal("r2_submission_plan")),
        r2_submission_actual: toIsoDate(getVal("r2_submission_actual")),
        r2_dar_plan: toIsoDate(getVal("r2_dar_plan")),
        r2_dar_actual: toIsoDate(getVal("r2_dar_actual")),
        r3_drafting_plan: toIsoDate(getVal("r3_drafting_plan")),
        r3_drafting_actual: toIsoDate(getVal("r3_drafting_actual")),
        r3_submission_plan: toIsoDate(getVal("r3_submission_plan")),
        r3_submission_actual: toIsoDate(getVal("r3_submission_actual")),
        r3_dar_plan: toIsoDate(getVal("r3_dar_plan")),
        r3_dar_actual: toIsoDate(getVal("r3_dar_actual")),
        raw_payload,
        excel_row: r + 1,
        sheet_name: name,
      };
      rows.push(row);
    }

    if (rows.length === 0 && skippedNoKey === 0) { result.ignored_sheets.push(name); continue; }

    result.sheets.push({
      sheet_name: name,
      team: teamFromFilename,
      plot: plotFromSheet,
      rows,
      skipped_no_key: skippedNoKey,
      warnings: [],
    });
  }

  // 파일 전체 중복 검출
  const seen = new Map<string, ParsedAbdRow[]>();
  for (const sh of result.sheets) {
    for (const row of sh.rows) {
      const arr = seen.get(row.abd_number);
      if (arr) arr.push(row);
      else seen.set(row.abd_number, [row]);
    }
  }
  for (const [abd_number, rows] of seen) {
    if (rows.length < 2) continue;
    result.duplicates_in_file.push({
      abd_number,
      occurrences: rows.map((r) => ({
        sheet_name: r.sheet_name,
        excel_row: r.excel_row,
        sl_no: r.sl_no,
        document_title: r.document_title,
      })),
    });
  }

  return result;
}