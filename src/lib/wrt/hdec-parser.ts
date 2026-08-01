import * as XLSX from "xlsx";

/**
 * WRT HDEC 임포트 파서 (왕복 임포트 구조).
 *
 * 입력 = Aconex 시딩본(WRT_Status_AconexSeeded.xlsx)을 담당자가 채워 되돌린 파일.
 * - 헤더 4행: r1 타이틀 / r2 밴드 / r3 단계명 / r4 Plan·Actual 서브헤더, 데이터는 r5부터
 * - 시트 2개: "WRT Plot 3" = PLOT-C, "WRT Plot 4" = PLOT-D (Plot 은 시트명에서 파생)
 * - 매퍼는 100% 헤더명 기준. 열 위치 기준 매핑 금지.
 * - Aconex 정본(회신코드 · 회신일 Actual · Latest Status · Final Approved)은 임포트 대상에서 제외.
 */

export const WRT_STAGE_LABELS: Record<
  string,
  { code: string; type: "flag" | "single" | "range"; authority: "HDEC" | "ACONEX" }
> = {
  "request for submission": { code: "REQ_SUBMISSION", type: "single", authority: "HDEC" },
  "response received": { code: "RESPONSE_RECEIVED", type: "range", authority: "HDEC" },
  negotiation: { code: "NEGOTIATION", type: "range", authority: "HDEC" },
  "confirmation of quotation": { code: "CONFIRM_QUOTATION", type: "single", authority: "HDEC" },
  "draft document (r1)": { code: "DRAFT_DOC_R1", type: "range", authority: "HDEC" },
  "submission (r1)": { code: "SUBMISSION_R1", type: "range", authority: "HDEC" },
  "response date (r1)": { code: "RESPONSE_DATE_R1", type: "single", authority: "ACONEX" },
  "draft document (r2)": { code: "DRAFT_DOC_R2", type: "range", authority: "HDEC" },
  "submission (r2)": { code: "SUBMISSION_R2", type: "range", authority: "HDEC" },
  "response date (r2)": { code: "RESPONSE_DATE_R2", type: "single", authority: "ACONEX" },
  "document preparation": { code: "DOC_PREPARATION", type: "range", authority: "HDEC" },
  "subcon stamp": { code: "SUBCON_STAMP", type: "range", authority: "HDEC" },
  "final submission": { code: "FINAL_SUBMISSION", type: "range", authority: "HDEC" },
};

/** 아이템 메타 컬럼 (헤더명 → wrt_items 컬럼) */
const ITEM_COLS: Record<string, string> = {
  team: "team",
  "hdec pic": "pic",
  "hdec eng": "eng",
};

/** Aconex 정본 — HDEC 임포트의 수정·삭제 대상에서 제외 */
const IGNORED_HEADERS = new Set([
  "dis",
  "service",
  "document title",
  "response by dar (r1)",
  "response by dar (r2)",
  "latest status",
  "final approved (a)",
  "approval status",
]);

export type StageFieldKey = "plan_start" | "actual_start" | "plan_finish" | "actual_finish" | "flag_value";

export interface ParsedWrtStage {
  stage_code: string;
  /** 파일에 존재하는 컬럼만 키로 담긴다. 값 null = 셀 공란(삭제 의도) */
  fields: Partial<Record<StageFieldKey, string | null>>;
}

export interface ParsedWrtRow {
  wrt_number: string;
  sheet_name: string;
  plot: "C" | "D";
  excel_row: number;
  item: Record<string, string | null>;
  stages: ParsedWrtStage[];
}

export interface ParsedWrtFile {
  file_name: string;
  sheets: Array<{ sheet_name: string; plot: "C" | "D"; rows: number }>;
  rows: ParsedWrtRow[];
  skipped_rows: number;
  unknown_headers: string[];
  present_stage_fields: Array<{ stage_code: string; field: StageFieldKey }>;
  present_item_fields: string[];
}

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

export async function parseWrtHdecFile(file: File): Promise<ParsedWrtFile> {
  const wb = XLSX.read(await file.arrayBuffer());
  const out: ParsedWrtFile = {
    file_name: file.name,
    sheets: [],
    rows: [],
    skipped_rows: 0,
    unknown_headers: [],
    present_stage_fields: [],
    present_item_fields: [],
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

    // 헤더행 탐색: "WRT NUMBER" 가 있는 행
    let hdrRow = -1;
    let numberCol = -1;
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (norm(cell(r, c)) === "wrt number") {
          hdrRow = r;
          numberCol = c;
          break;
        }
      }
      if (hdrRow >= 0) break;
    }
    if (hdrRow < 0) {
      throw new Error(`시트 "${sheetName}": 'WRT NUMBER' 헤더를 찾지 못했습니다. HDEC 임포트 양식이 맞는지 확인하세요.`);
    }
    const subRow = hdrRow + 1;

    type ColMap =
      | { kind: "item"; col: number; field: string }
      | { kind: "stage"; col: number; stage_code: string; field: StageFieldKey };
    const cols: ColMap[] = [];
    let currentStage: { code: string; type: "flag" | "single" | "range"; authority: "HDEC" | "ACONEX" } | null = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const label = norm(cell(hdrRow, c));
      const sub = norm(cell(subRow, c));
      if (label) {
        currentStage = null;
        if (label === "wrt number" || IGNORED_HEADERS.has(label)) continue;
        if (ITEM_COLS[label]) {
          cols.push({ kind: "item", col: c, field: ITEM_COLS[label] });
          presentItem.add(ITEM_COLS[label]);
          continue;
        }
        const stage = WRT_STAGE_LABELS[label];
        if (!stage) {
          unknown.add(String(cell(hdrRow, c)));
          continue;
        }
        currentStage = stage;
      }
      if (!currentStage) continue;
      const field = subFieldKey(sub, currentStage.type);
      if (!field) continue;
      // 권위 모델: Aconex 정본 실적(회신일)은 HDEC 임포트 대상에서 제외
      if (currentStage.authority !== "HDEC" && (field === "actual_start" || field === "actual_finish")) continue;
      cols.push({ kind: "stage", col: c, stage_code: currentStage.code, field });
      presentStage.add(`${currentStage.code}|${field}`);
    }

    let sheetRows = 0;
    for (let r = subRow + 1; r <= range.e.r; r++) {
      const wrtNumber = String(cell(r, numberCol) ?? "").trim();
      if (!wrtNumber) {
        out.skipped_rows += 1;
        continue;
      }
      const item: Record<string, string | null> = {};
      const stageMap = new Map<string, ParsedWrtStage>();
      for (const cm of cols) {
        const raw = cell(r, cm.col);
        if (cm.kind === "item") {
          const s = String(raw ?? "").trim();
          item[cm.field] = s === "" ? null : s;
        } else {
          let entry = stageMap.get(cm.stage_code);
          if (!entry) {
            entry = { stage_code: cm.stage_code, fields: {} };
            stageMap.set(cm.stage_code, entry);
          }
          if (cm.field === "flag_value") {
            const s = String(raw ?? "").trim();
            entry.fields.flag_value = s === "" ? null : s;
          } else {
            entry.fields[cm.field] = raw == null || String(raw).trim() === "" ? null : toIso(raw);
          }
        }
      }
      out.rows.push({
        wrt_number: wrtNumber,
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
    throw new Error("Plot 시트를 찾지 못했습니다 (예: 'WRT Plot 3' / 'WRT Plot 4').");
  }
  out.unknown_headers = Array.from(unknown);
  out.present_item_fields = Array.from(presentItem);
  out.present_stage_fields = Array.from(presentStage).map((k) => {
    const [stage_code, field] = k.split("|");
    return { stage_code, field: field as StageFieldKey };
  });
  return out;
}