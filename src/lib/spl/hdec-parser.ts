import * as XLSX from "xlsx";

/**
 * SPL HDEC 임포트 파서 (왕복 임포트 구조).
 *
 * 입력 = Aconex 시딩본(SPL_Status_AconexSeeded.xlsx)을 담당자가 채워 되돌린 파일.
 * - 헤더 4행: r1 타이틀 / r2 밴드 / r3 단계명 / r4 Plan·Actual 서브헤더, 데이터는 r5부터
 * - 시트 2개: "SPL Plot 3" = PLOT-C, "SPL Plot 4" = PLOT-D (Plot 은 시트명에서 파생)
 * - 매퍼는 100% 헤더명 기준. 열 위치 기준 매핑 금지.
 * - 번호 패턴 `-OCS-` 는 Aconex 루틴 산출물이므로 항상 제외하고 건수를 보고한다.
 */

export const SPL_STAGE_LABELS: Record<
  string,
  { code: string; type: "flag" | "single" | "range"; authority: "HDEC" | "ACONEX"; short: string }
> = {
  "physical list": { code: "PHYSICAL_LIST", type: "flag", authority: "HDEC", short: "R-PL" },
  "rec. letter 2y": { code: "REC_LETTER_2Y", type: "flag", authority: "HDEC", short: "R-2Y" },
  "rec. letter 5y": { code: "REC_LETTER_5Y", type: "flag", authority: "HDEC", short: "R-5Y" },
  "availability 10y": { code: "AVAILABILITY_10Y", type: "flag", authority: "HDEC", short: "R-10Y" },
  others: { code: "OTHERS_DOC", type: "flag", authority: "HDEC", short: "R-OT" },
  "request for resubmission": { code: "REQ_RESUBMISSION", type: "single", authority: "HDEC", short: "D-SU" },
  "response received": { code: "RESPONSE_RECEIVED", type: "single", authority: "HDEC", short: "D-RV" },
  "review response from sub": { code: "REVIEW_RESPONSE", type: "range", authority: "HDEC", short: "D-VW" },
  "internal q'ty verification": { code: "INTERNAL_QTY_VERIF", type: "range", authority: "HDEC", short: "D-QV" },
  "substantiation preparation": { code: "SUBSTANTIATION_PREP", type: "range", authority: "HDEC", short: "D-PR" },
  "dar acceptance": { code: "DAR_ACCEPTANCE", type: "range", authority: "HDEC", short: "D-DA" },
  submission: { code: "SUBMISSION", type: "range", authority: "HDEC", short: "D-SB" },
  "approval date": { code: "APPROVAL_DATE", type: "single", authority: "ACONEX", short: "D-AP" },
  // 2026-08-11 표시 라벨 개명(Approval Date → Dar Response Date). 옛 헤더는 별칭으로 유지 —
  // 이미 배포된 왕복 양식이 현장에 돌고 있어 지우면 그 파일이 미매핑된다.
  "dar response date": { code: "APPROVAL_DATE", type: "single", authority: "ACONEX", short: "D-AP" },
  "code b to a": { code: "CODE_B_TO_A", type: "range", authority: "HDEC", short: "D-BA" },
  "rfq draft": { code: "RFQ_DRAFT", type: "range", authority: "HDEC", short: "P-QD" },
  rfq: { code: "RFQ", type: "single", authority: "HDEC", short: "P-RQ" },
  quotation: { code: "QUOTATION", type: "single", authority: "HDEC", short: "P-QT" },
  "review quotation": { code: "REVIEW_QUOTATION", type: "range", authority: "HDEC", short: "P-WQ" },
  "confirmation of quotation": { code: "CONFIRM_QUOTATION", type: "single", authority: "HDEC", short: "P-CQ" },
  "hq (above 100k)": { code: "HQ_APPROVAL", type: "range", authority: "HDEC", short: "P-HQ" },
  mrs: { code: "MRS", type: "range", authority: "HDEC", short: "P-MR" },
  "issuance of po": { code: "PO_ISSUANCE", type: "single", authority: "HDEC", short: "P-PO" },
};

/** View 양식(화면 표시 그대로) 헤더 = 카탈로그 short_code (+ 필드 접미사) */
const SPL_SHORT_CODES: Record<string, { code: string; type: "flag" | "single" | "range" }> = Object.fromEntries(
  Object.values(SPL_STAGE_LABELS).map((s) => [s.short.toLowerCase(), { code: s.code, type: s.type }]),
);

const VIEW_SUFFIX: Record<string, StageFieldKey> = {
  "-pd": "plan_start",
  "-ad": "actual_start",
  "-ps": "plan_start",
  "-as": "actual_start",
  "-pf": "plan_finish",
  "-af": "actual_finish",
};

/** View 양식에서 spl_items 로 반영하는 컬럼 (헤더 라벨 기준) */
const VIEW_ITEM_COLS: Record<string, string> = {
  team: "team",
  pic: "pic",
  eng: "eng",
  "pic po": "pic_po",
  "eng po": "eng_po",
  supplier: "supplier",
  plot: "plot",
};

/** 팀 표기 정규화 — 매핑은 이 한 곳(파서)에서만 한다 */
export function normalizeTeam(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return null;
  const u = t.toUpperCase();
  if (u === "CIVIL") return "PRJC";
  if (u === "MEP") return "ELEC";
  return t;
}

/** Aconex 권위 단계 — 실적은 값이 있을 때만 반영 (빈칸이 기존 값을 지우지 않는다) */
export const SPL_ACONEX_STAGES = new Set(["APPROVAL_DATE"]);

/** 아이템 메타 컬럼 (헤더명 → spl_items 컬럼) */
const ITEM_COLS: Record<string, string> = {
  team: "team",
  "hdec pic": "pic",
  "hdec eng": "eng",
  "hdec pic (po)": "pic_po",
  "hdec eng (po)": "eng_po",
  supplier: "supplier",
};

/** Aconex 정본 — HDEC 임포트의 수정·삭제 대상에서 제외 */
const IGNORED_HEADERS = new Set([
  "dis",
  "service",
  "document title",
  "approval status",
  // 개명 후 헤더. 옛 이름도 그대로 남긴다.
  "response status",
]);

export type StageFieldKey = "plan_start" | "actual_start" | "plan_finish" | "actual_finish" | "flag_value";

export interface ParsedSplStage {
  stage_code: string;
  /** 파일에 존재하는 컬럼만 키로 담긴다. 값 null = 셀 공란(삭제 의도) */
  fields: Partial<Record<StageFieldKey, string | null>>;
  /** 파일에 "NA" 로 표기된 칸이 하나라도 있으면 true (해당 없음) */
  na?: boolean;
}

export interface ParsedSplRow {
  spl_number: string;
  sheet_name: string;
  plot: "C" | "D";
  excel_row: number;
  /** 존재하는 컬럼만. 값 null = 공란(삭제 의도) */
  item: Record<string, string | null>;
  stages: ParsedSplStage[];
}

export interface ParsedSplFile {
  file_name: string;
  /** hdec = 4행 헤더 왕복 양식 / view = Raw Data 화면 표시 그대로 내보낸 양식 */
  format: "hdec" | "view";
  sheets: Array<{ sheet_name: string; plot: "C" | "D"; rows: number }>;
  rows: ParsedSplRow[];
  /** `-OCS-` 패턴으로 제외된 행 */
  ocs_excluded: number;
  ocs_samples: string[];
  /** 빈 SPL NUMBER 등으로 건너뛴 행 */
  skipped_rows: number;
  /** 카탈로그에 없는 단계 헤더 */
  unknown_headers: string[];
  /** 파일에 존재한 단계 컬럼 (컬럼 부재 vs 공란 구분용) */
  present_stage_fields: Array<{ stage_code: string; field: StageFieldKey }>;
  present_item_fields: string[];
  /** "NA" 로 표기된 날짜 칸 수 */
  na_cells: number;
  /** View 양식에서 임포트 대상이 아니어서 무시한 컬럼 (파생·Aconex 정본) */
  ignored_headers: string[];
}

/** 파일 셀이 "해당 없음" 표기인지 */
export function isNaMarker(v: unknown): boolean {
  const s = String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[.\-_/]/g, "");
  return s === "na" || s === "notapplicable";
}

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isOcsNumber(splNumber: string): boolean {
  // 대시 변종(U+2010 등)이 섞인 `‐OCS-` 도 제외되어야 한다. 정규화 후 판정.
  return isOcsDocumentNumber(splNumber);
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
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const da = Number(dmy[1]);
    const mo = Number(dmy[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const yy = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  return null;
}

function subFieldKey(sub: string, type: "flag" | "single" | "range"): StageFieldKey | null {
  const s = norm(sub);
  if (type === "flag") return "flag_value";
  if (s.startsWith("plan") && s.includes("date")) return "plan_start";
  if (s.startsWith("actual") && s.includes("date")) return "actual_start";
  if (s.startsWith("plan") && s.includes("start")) return "plan_start";
  if (s.startsWith("actual") && s.includes("start")) return "actual_start";
  if (s.startsWith("plan") && s.includes("finish")) return "plan_finish";
  if (s.startsWith("actual") && s.includes("finish")) return "actual_finish";
  return null;
}

function plotFromSheet(name: string): "C" | "D" | null {
  const m = norm(name).match(/plot[\s-]*([34cd])/);
  if (!m) return null;
  const t = m[1];
  if (t === "3" || t === "c") return "C";
  if (t === "4" || t === "d") return "D";
  return null;
}

function plotFromValue(v: unknown): "C" | "D" | null {
  const t = norm(v).replace(/^plot[\s-]*/, "");
  if (t === "c" || t === "3") return "C";
  if (t === "d" || t === "4") return "D";
  return null;
}

function emptyParsed(fileName: string, format: "hdec" | "view"): ParsedSplFile {
  return {
    file_name: fileName,
    format,
    sheets: [],
    rows: [],
    ocs_excluded: 0,
    ocs_samples: [],
    skipped_rows: 0,
    unknown_headers: [],
    present_stage_fields: [],
    present_item_fields: [],
    na_cells: 0,
    ignored_headers: [],
  };
}

/** 헤더 1행 구조(화면 표시 그대로) 인지 판정 — "SPL NUMBER" 와 "Plot" 이 같은 행에 있으면 View 양식 */
function findViewHeader(ws: XLSX.WorkSheet): { row: number; numberCol: number } | null {
  if (!ws["!ref"]) return null;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    let numberCol = -1;
    let hasPlot = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = norm(ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null);
      if (t === "spl number") numberCol = c;
      if (t === "plot") hasPlot = true;
    }
    if (numberCol >= 0 && hasPlot) return { row: r, numberCol };
  }
  return null;
}

/**
 * View 양식(Raw Data 화면 표시 그대로 내보낸 파일) 파서.
 * - 헤더 1행. 아이템 컬럼은 라벨, 단계 컬럼은 카탈로그 short_code(+접미사) 로만 매핑한다.
 * - 파생/Aconex 정본 컬럼은 임포트 대상이 아니므로 무시하고 목록으로 보고한다.
 */
function parseSplViewWorkbook(wb: XLSX.WorkBook, fileName: string): ParsedSplFile {
  const out = emptyParsed(fileName, "view");
  const presentStage = new Set<string>();
  const presentItem = new Set<string>();
  const ignored = new Set<string>();
  const unknown = new Set<string>();
  const perPlot = new Map<string, { sheet_name: string; plot: "C" | "D"; rows: number }>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const hdr = ws ? findViewHeader(ws) : null;
    if (!ws || !hdr || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;

    type ColMap =
      | { kind: "item"; col: number; field: string }
      | { kind: "stage"; col: number; stage_code: string; field: StageFieldKey };
    const cols: ColMap[] = [];
    let plotCol = -1;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const raw = String(cell(hdr.row, c) ?? "").trim();
      const label = norm(raw);
      if (!label || label === "spl number") continue;
      if (label === "plot") {
        plotCol = c;
        cols.push({ kind: "item", col: c, field: "plot" });
        presentItem.add("plot");
        continue;
      }
      const itemField = VIEW_ITEM_COLS[label];
      if (itemField) {
        cols.push({ kind: "item", col: c, field: itemField });
        presentItem.add(itemField);
        continue;
      }
      const m = label.match(/^([a-z0-9]-[a-z0-9]{1,3})(-(pd|ad|ps|as|pf|af))?$/);
      const stage = m ? SPL_SHORT_CODES[m[1]] : undefined;
      if (stage) {
        const field: StageFieldKey = m![2] ? VIEW_SUFFIX[m![2]] : "flag_value";
        if (stage.type === "flag" && field !== "flag_value") {
          unknown.add(raw);
          continue;
        }
        cols.push({ kind: "stage", col: c, stage_code: stage.code, field });
        presentStage.add(`${stage.code}|${field}`);
        continue;
      }
      ignored.add(raw);
    }

    if (plotCol < 0) {
      throw new Error(
        `시트 "${sheetName}": View 양식 임포트에는 'Plot' 컬럼이 필요합니다. Raw Data 화면에서 Plot 컬럼을 표시한 뒤 다시 내보내세요.`,
      );
    }

    for (let r = hdr.row + 1; r <= range.e.r; r++) {
      const splNumber = String(cell(r, hdr.numberCol) ?? "").trim();
      if (!splNumber) {
        out.skipped_rows += 1;
        continue;
      }
      if (isOcsNumber(splNumber)) {
        out.ocs_excluded += 1;
        if (out.ocs_samples.length < 20) out.ocs_samples.push(splNumber);
        continue;
      }
      const plot = plotFromValue(cell(r, plotCol));
      if (!plot) {
        out.skipped_rows += 1;
        continue;
      }
      const item: Record<string, string | null> = {};
      const stageMap = new Map<string, ParsedSplStage>();
      for (const cm of cols) {
        const raw = cell(r, cm.col);
        if (cm.kind === "item") {
          if (cm.field === "plot") {
            item.plot = plot;
            continue;
          }
          const s = String(raw ?? "").trim();
          const val = s === "" ? null : s;
          item[cm.field] = cm.field === "team" ? normalizeTeam(val) : val;
        } else {
          let entry = stageMap.get(cm.stage_code);
          if (!entry) {
            entry = { stage_code: cm.stage_code, fields: {} };
            stageMap.set(cm.stage_code, entry);
          }
          if (cm.field === "flag_value") {
            const s = String(raw ?? "").trim();
            entry.fields.flag_value = s === "" ? null : s;
          } else if (isNaMarker(raw)) {
            entry.na = true;
            entry.fields[cm.field] = null;
            out.na_cells += 1;
          } else {
            entry.fields[cm.field] = raw == null || String(raw).trim() === "" ? null : toIso(raw);
          }
        }
      }
      out.rows.push({ spl_number: splNumber, sheet_name: sheetName, plot, excel_row: r + 1, item, stages: Array.from(stageMap.values()) });
      const agg = perPlot.get(plot) ?? { sheet_name: sheetName, plot, rows: 0 };
      agg.rows += 1;
      perPlot.set(plot, agg);
    }
  }

  if (out.rows.length === 0) {
    throw new Error("View 양식에서 임포트할 행을 찾지 못했습니다. 'SPL NUMBER' 와 'Plot' 컬럼이 포함된 파일인지 확인하세요.");
  }
  out.sheets = Array.from(perPlot.values());
  out.unknown_headers = Array.from(unknown);
  out.ignored_headers = Array.from(ignored);
  out.present_item_fields = Array.from(presentItem);
  out.present_stage_fields = Array.from(presentStage).map((k) => {
    const [stage_code, field] = k.split("|");
    return { stage_code, field: field as StageFieldKey };
  });
  return out;
}

export async function parseSplHdecFile(file: File): Promise<ParsedSplFile> {
  const wb = XLSX.read(await file.arrayBuffer());
  // View 양식(1행 헤더 + Plot 컬럼)이면 그 경로로 파싱한다.
  if (wb.SheetNames.some((n) => wb.Sheets[n] && findViewHeader(wb.Sheets[n]))) {
    return parseSplViewWorkbook(wb, file.name);
  }
  const out = emptyParsed(file.name, "hdec");
  const presentStage = new Set<string>();
  const presentItem = new Set<string>();
  const unknown = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const plot = plotFromSheet(sheetName);
    if (!plot) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;

    // 헤더행 탐색: "SPL NUMBER" 가 있는 행
    let hdrRow = -1;
    let numberCol = -1;
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (norm(cell(r, c)) === "spl number") {
          hdrRow = r;
          numberCol = c;
          break;
        }
      }
      if (hdrRow >= 0) break;
    }
    if (hdrRow < 0) {
      throw new Error(`시트 "${sheetName}": 'SPL NUMBER' 헤더를 찾지 못했습니다. HDEC 임포트 양식이 맞는지 확인하세요.`);
    }
    const subRow = hdrRow + 1;

    // 컬럼 매핑 (헤더명 기준, 병합셀은 좌측 라벨 forward-fill)
    type ColMap =
      | { kind: "item"; col: number; field: string }
      | { kind: "stage"; col: number; stage_code: string; field: StageFieldKey };
    const cols: ColMap[] = [];
    let currentStage: { code: string; type: "flag" | "single" | "range" } | null = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const label = norm(cell(hdrRow, c));
      const sub = norm(cell(subRow, c));
      if (label) {
        currentStage = null;
        if (label === "spl number" || IGNORED_HEADERS.has(label)) continue;
        if (ITEM_COLS[label]) {
          cols.push({ kind: "item", col: c, field: ITEM_COLS[label] });
          presentItem.add(ITEM_COLS[label]);
          continue;
        }
        const stage = SPL_STAGE_LABELS[label];
        if (!stage) {
          unknown.add(String(cell(hdrRow, c)));
          continue;
        }
        currentStage = { code: stage.code, type: stage.type };
      }
      if (!currentStage) continue;
      const field = subFieldKey(sub, currentStage.type);
      if (!field) continue;
      cols.push({ kind: "stage", col: c, stage_code: currentStage.code, field });
      presentStage.add(`${currentStage.code}|${field}`);
    }

    let sheetRows = 0;
    for (let r = subRow + 1; r <= range.e.r; r++) {
      const splNumber = String(cell(r, numberCol) ?? "").trim();
      if (!splNumber) {
        out.skipped_rows += 1;
        continue;
      }
      if (isOcsNumber(splNumber)) {
        out.ocs_excluded += 1;
        if (out.ocs_samples.length < 20) out.ocs_samples.push(splNumber);
        continue;
      }
      const item: Record<string, string | null> = {};
      const stageMap = new Map<string, ParsedSplStage>();
      for (const cm of cols) {
        const raw = cell(r, cm.col);
        if (cm.kind === "item") {
          const s = String(raw ?? "").trim();
          const val = s === "" ? null : s;
          item[cm.field] = cm.field === "team" ? normalizeTeam(val) : val;
        } else {
          let entry = stageMap.get(cm.stage_code);
          if (!entry) {
            entry = { stage_code: cm.stage_code, fields: {} };
            stageMap.set(cm.stage_code, entry);
          }
          if (cm.field === "flag_value") {
            const s = String(raw ?? "").trim();
            entry.fields.flag_value = s === "" ? null : s;
          } else if (isNaMarker(raw)) {
            entry.na = true;
            entry.fields[cm.field] = null;
            out.na_cells += 1;
          } else {
            entry.fields[cm.field] = raw == null || String(raw).trim() === "" ? null : toIso(raw);
          }
        }
      }
      out.rows.push({
        spl_number: splNumber,
        sheet_name: sheetName,
        plot,
        excel_row: r + 1,
        item,
        stages: Array.from(stageMap.values()),
      });
      sheetRows += 1;
    }
    out.sheets.push({ sheet_name: sheetName, plot, rows: sheetRows });
  }

  if (out.sheets.length === 0) {
    throw new Error("Plot 시트를 찾지 못했습니다 (예: 'SPL Plot 3' / 'SPL Plot 4').");
  }
  out.unknown_headers = Array.from(unknown);
  out.present_item_fields = Array.from(presentItem);
  out.present_stage_fields = Array.from(presentStage).map((k) => {
    const [stage_code, field] = k.split("|");
    return { stage_code, field: field as StageFieldKey };
  });
  return out;
}