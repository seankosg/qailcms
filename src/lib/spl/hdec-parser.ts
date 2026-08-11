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
const IGNORED_HEADERS = new Set(["dis", "service", "document title", "approval status"]);

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
  return /-OCS-/i.test(splNumber ?? "");
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

export async function parseSplHdecFile(file: File): Promise<ParsedSplFile> {
  const wb = XLSX.read(await file.arrayBuffer());
  const out: ParsedSplFile = {
    file_name: file.name,
    sheets: [],
    rows: [],
    ocs_excluded: 0,
    ocs_samples: [],
    skipped_rows: 0,
    unknown_headers: [],
    present_stage_fields: [],
    present_item_fields: [],
    na_cells: 0,
  };
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