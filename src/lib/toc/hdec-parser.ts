import * as XLSX from "xlsx";
import { makeDateAudit, strictParseDateValue, toCellRef, type DateIssue } from "@/lib/import/date-audit";
import { normalizeTocCode } from "./code-value";
import { buildTocColumns, TOC_ITEM_COLS, type TocRtCol } from "./roundtrip-export";
import type { TocCatalogEntry } from "./rows.functions";

/**
 * TOC(Handover) 왕복 임포트 파서.
 *
 * 프로젝트 임포트 규칙을 그대로 따른다.
 *  - 헤더는 **텍스트로만** 찾는다. 못 찾으면 미매핑으로 남기고 그 컬럼을 임포트에서 제외한다.
 *    위치·순서·인덱스로 컬럼을 가정하지 않는다.
 *  - 값의 형태가 필드 정의와 다르면 헤더가 맞아도 **미매핑으로 강등**한다(임계 80%,
 *    ITEM KEY 는 90% 미만이면 파싱 중단). 강등 표시에 실측 비율·모집단·표본 3건을 함께 낸다.
 *  - 코드형 값은 사전(`code-value.ts`)과 대조한다. 사전이 있는 단계에서 미등록 값이면 저장하지 않고 보고한다.
 *  - 팀은 Civil → ARCH 로 정규화하고 원문은 `team_raw` 로 보관한다.
 *  - 교육 밴드(TRN_*)는 정본이 교육 세션 표이므로 파일 값으로 쓰지 않고 무시 목록에 남긴다.
 */

export type TocStageFieldKey =
  | "plan_start"
  | "actual_start"
  | "plan_finish"
  | "actual_finish"
  | "code_value";

export interface ParsedTocStage {
  stage_code: string;
  /** 파일에 존재하는 컬럼만 키로 담긴다. 값 null = 셀 공란(삭제 의도) */
  fields: Partial<Record<TocStageFieldKey, string | null>>;
}

export interface ParsedTocRow {
  item_key: string;
  sheet_name: string;
  plot: "C" | "D";
  excel_row: number;
  item: Record<string, string | null>;
  stages: ParsedTocStage[];
}

export interface DemotedColumn {
  header: string;
  sub: string | null;
  field: string;
  reason: string;
  /** 형태가 맞은 비율(%) */
  validPct: number;
  population: number;
  samples: string[];
}

export interface ParsedTocFile {
  file_name: string;
  sheets: Array<{ sheet_name: string; plot: "C" | "D"; rows: number }>;
  rows: ParsedTocRow[];
  skipped_rows: number;
  /** 카탈로그·정의에 없는 헤더 (임포트 제외) */
  unmapped_headers: string[];
  /** 값 형태 불일치로 강등된 컬럼 (임포트 제외) */
  demoted_columns: DemotedColumn[];
  /** 정본이 달라 의도적으로 무시한 컬럼 (파생·판정·교육 롤업) */
  ignored_headers: string[];
  present_item_fields: string[];
  present_stage_fields: Array<{ stage_code: string; field: TocStageFieldKey }>;
  /** 사전에 없는 상태 코드 값 — 저장하지 않는다 */
  unknown_code_values: Array<{
    value: string;
    item_key: string;
    sheet_name: string;
    excel_row: number;
    stage_code: string;
  }>;
  dateIssues: DateIssue[];
}

export interface ParseTocOptions {
  dateOverrides?: Record<string, string>;
}

const DEMOTE_THRESHOLD = 80;
const KEY_THRESHOLD = 90;

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 팀 표기 정규화 — 매핑은 이 한 곳(파서)에서만 한다. 원문은 team_raw 로 따로 보관한다. */
export function normalizeTocTeam(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t) return null;
  const u = t.toUpperCase();
  if (u === "CIVIL" || u === "ARCHI" || u === "ARCHITECTURAL" || u === "ARCH") return "ARCH";
  if (u === "MECH" || u === "MECHANICAL") return "MECH";
  if (u === "ELEC" || u === "ELECTRICAL") return "ELEC";
  if (u === "PRJC" || u === "PROJECT") return "PRJC";
  return null;
}

function plotFromSheet(name: string): "C" | "D" | null {
  const m = norm(name).match(/plot[\s-]*([34cd])/);
  if (!m) return null;
  return m[1] === "3" || m[1] === "c" ? "C" : "D";
}

function plotFromValue(v: unknown): "C" | "D" | null {
  const t = norm(v).replace(/^plot[\s-]*/, "");
  if (t === "c" || t === "3") return "C";
  if (t === "d" || t === "4") return "D";
  return null;
}

/** 파생·판정·교육 롤업 열 — 파일에 있어도 임포트하지 않는다 */
const IGNORED_HEADERS = new Set([
  "toc status",
  "readiness",
  "judgment",
  "top delay stage",
  "delayed stages",
  "training sessions",
  "h/o status (source)",
  "excluded",
  "exclusion reason",
  "data date",
]);

type ColMap =
  | { kind: "item"; col: number; def: Extract<TocRtCol, { kind: "item" }> }
  | { kind: "stage"; col: number; stage_code: string; field: TocStageFieldKey; header: string; sub: string; readOnly: boolean };

function subFieldKey(sub: string): TocStageFieldKey | null {
  const s = norm(sub);
  if (s.includes("status") || s.includes("code")) return "code_value";
  if (s.startsWith("plan") && s.includes("start")) return "plan_start";
  if (s.startsWith("actual") && s.includes("start")) return "actual_start";
  if (s.startsWith("plan")) return "plan_finish";
  if (s.startsWith("actual")) return "actual_finish";
  return null;
}

export async function parseTocHdecFile(
  file: File,
  catalog: TocCatalogEntry[],
  options?: ParseTocOptions,
): Promise<ParsedTocFile> {
  const wb = XLSX.read(await file.arrayBuffer());
  const cols4 = buildTocColumns(catalog);
  const stageByLabel = new Map<string, { code: string; readOnly: boolean }>();
  for (const c of cols4) {
    if (c.kind === "stage") stageByLabel.set(norm(c.header), { code: c.stage_code, readOnly: !!c.readOnly });
  }
  const itemByHeader = new Map(TOC_ITEM_COLS.map((c) => [norm(c.header), c]));

  const out: ParsedTocFile = {
    file_name: file.name,
    sheets: [],
    rows: [],
    skipped_rows: 0,
    unmapped_headers: [],
    demoted_columns: [],
    ignored_headers: [],
    present_item_fields: [],
    present_stage_fields: [],
    unknown_code_values: [],
    dateIssues: [],
  };

  const { audit, read: readDateCell } = makeDateAudit(options?.dateOverrides);
  const unmapped = new Set<string>();
  const ignored = new Set<string>();
  const presentItem = new Set<string>();
  const presentStage = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const plot = plotFromSheet(sheetName);
    if (!plot) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;

    // 헤더행 탐색 — "ITEM KEY" 텍스트가 있는 행 (위치 추정 금지)
    let hdrRow = -1;
    let keyCol = -1;
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30) && hdrRow < 0; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (norm(cell(r, c)) === "item key") {
          hdrRow = r;
          keyCol = c;
          break;
        }
      }
    }
    if (hdrRow < 0) {
      throw new Error(`시트 "${sheetName}": 'ITEM KEY' 헤더를 찾지 못했습니다. TOC 임포트 양식이 맞는지 확인하세요.`);
    }
    const subRow = hdrRow + 1;

    // 컬럼 매핑 (헤더 텍스트 기준, 병합셀은 좌측 라벨 forward-fill)
    const mapped: ColMap[] = [];
    let currentStage: { code: string; readOnly: boolean } | null = null;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const rawLabel = String(cell(hdrRow, c) ?? "").trim();
      const label = norm(rawLabel);
      const sub = String(cell(subRow, c) ?? "").trim();
      if (label) {
        currentStage = null;
        if (label === "item key") continue;
        if (IGNORED_HEADERS.has(label)) {
          ignored.add(rawLabel);
          continue;
        }
        const itemDef = itemByHeader.get(label);
        if (itemDef) {
          mapped.push({ kind: "item", col: c, def: itemDef });
          continue;
        }
        const stage = stageByLabel.get(label);
        if (!stage) {
          unmapped.add(rawLabel);
          continue;
        }
        if (stage.readOnly) {
          ignored.add(`${rawLabel} (교육 세션 정본)`);
          continue;
        }
        currentStage = stage;
      }
      if (!currentStage) continue;
      const field = subFieldKey(sub);
      if (!field) {
        if (sub) unmapped.add(`${rawLabel || currentStage.code} / ${sub}`);
        continue;
      }
      mapped.push({
        kind: "stage",
        col: c,
        stage_code: currentStage.code,
        field,
        header: rawLabel || currentStage.code,
        sub,
      readOnly: false,
      });
    }

    const dataRows: number[] = [];
    for (let r = subRow + 1; r <= range.e.r; r++) dataRows.push(r);

    // ── 값 형태 검증 (헤더가 맞아도 형태가 다르면 강등) ────────────────────────
    const keyVals = dataRows.map((r) => String(cell(r, keyCol) ?? "").trim()).filter((s) => s !== "");
    // 데이터 행이 아예 없는 시트(해당 Plot 항목 0건)는 빈 양식으로 보고 조용히 넘긴다 — 오류가 아니다.
    if (keyVals.length === 0) {
      out.sheets.push({ sheet_name: sheetName, plot, rows: 0 });
      continue;
    }
    const keyValid = keyVals.filter((s) => s.length >= 3 && /[A-Za-z]/.test(s));
    const keyPct = Math.round((keyValid.length * 1000) / keyVals.length) / 10;
    if (keyPct < KEY_THRESHOLD) {
      throw new Error(
        `시트 "${sheetName}": ITEM KEY 값 형태가 맞는 비율 ${keyPct}% (모집단 ${keyVals.length}건, 임계 ${KEY_THRESHOLD}%) — 파싱을 중단했습니다. 표본: ${keyVals
          .slice(0, 3)
          .map((s) => `"${s}"`)
          .join(", ") || "(없음)"}`,
      );
    }


    const dropped = new Set<ColMap>();
    const checkShape = (cm: ColMap, kind: "date" | "number") => {
      const vals = dataRows.map((r) => cell(r, cm.col)).filter((v) => v != null && String(v).trim() !== "");
      if (vals.length === 0) return;
      const ok = vals.filter((v) =>
        kind === "date" ? strictParseDateValue(v) != null : Number.isFinite(Number(String(v).replace(/,/g, ""))),
      );
      const pct = Math.round((ok.length * 1000) / vals.length) / 10;
      if (pct >= DEMOTE_THRESHOLD) return;
      dropped.add(cm);
      const header = cm.kind === "item" ? cm.def.header : cm.header;
      const sub = cm.kind === "item" ? null : cm.sub || null;
      out.demoted_columns.push({
        header,
        sub,
        field: cm.kind === "item" ? cm.def.field : `${cm.stage_code}.${cm.field}`,
        reason: kind === "date" ? "날짜로 읽히지 않는 값이 많음" : "숫자로 읽히지 않는 값이 많음",
        validPct: pct,
        population: vals.length,
        samples: vals.slice(0, 3).map((v) => String(v)),
      });
    };
    for (const cm of mapped) {
      if (cm.kind === "item") {
        if (cm.def.date) checkShape(cm, "date");
        else if (cm.def.numeric) checkShape(cm, "number");
      } else if (cm.field !== "code_value") {
        checkShape(cm, "date");
      }
    }
    const active = mapped.filter((cm) => !dropped.has(cm));
    for (const cm of active) {
      if (cm.kind === "item") presentItem.add(cm.def.field);
      else presentStage.add(`${cm.stage_code}|${cm.field}`);
    }

    // ── 행 읽기 ────────────────────────────────────────────────────────────
    let sheetRows = 0;
    for (const r of dataRows) {
      const itemKey = String(cell(r, keyCol) ?? "").trim();
      if (!itemKey) {
        out.skipped_rows += 1;
        continue;
      }
      const item: Record<string, string | null> = {};
      const stageMap = new Map<string, ParsedTocStage>();

      for (const cm of active) {
        const raw = cell(r, cm.col);
        if (cm.kind === "item") {
          if (cm.def.locked) continue;
          if (cm.def.field === "plot") {
            const p = plotFromValue(raw) ?? plot;
            item.plot = p;
            continue;
          }
          if (cm.def.date) {
            item[cm.def.field] = readDateCell(raw, {
              cellRef: `${sheetName}!${toCellRef(r + 1, cm.col + 1)}`,
              row: r + 1,
              col: cm.col + 1,
              field: cm.def.field,
              header: cm.def.header,
            });
            continue;
          }
          const s = String(raw ?? "").trim();
          const val = s === "" ? null : s;
          if (cm.def.field === "team") item.team = normalizeTocTeam(val);
          else if (cm.def.field === "team_raw") {
            item.team_raw = val;
            // 원문 Trade 로부터 정규화 팀을 함께 갱신한다 (파일에 TEAM 열이 없을 때도 일관 유지)
            if (!active.some((x) => x.kind === "item" && x.def.field === "team")) {
              const t = normalizeTocTeam(val);
              if (t) item.team = t;
            }
          } else if (cm.def.numeric) {
            item[cm.def.field] = val == null ? null : String(Math.trunc(Number(val.replace(/,/g, ""))));
          } else item[cm.def.field] = val;
          continue;
        }

        let entry = stageMap.get(cm.stage_code);
        if (!entry) {
          entry = { stage_code: cm.stage_code, fields: {} };
          stageMap.set(cm.stage_code, entry);
        }
        if (cm.field === "code_value") {
          const res = normalizeTocCode(cm.stage_code, raw);
          if (res.invalid) {
            out.unknown_code_values.push({
              value: res.invalid,
              item_key: itemKey,
              sheet_name: sheetName,
              excel_row: r + 1,
              stage_code: cm.stage_code,
            });
            continue; // 저장하지 않는다 (기존 값 유지)
          }
          entry.fields.code_value = res.value;
        } else {
          entry.fields[cm.field] = readDateCell(raw, {
            cellRef: `${sheetName}!${toCellRef(r + 1, cm.col + 1)}`,
            row: r + 1,
            col: cm.col + 1,
            field: cm.field,
            header: `${cm.header} · ${cm.sub}`,
          });
        }
      }

      out.rows.push({
        item_key: itemKey,
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
    throw new Error("Plot 시트를 찾지 못했습니다 (예: 'TOC Plot 3' / 'TOC Plot 4').");
  }
  out.unmapped_headers = Array.from(unmapped);
  out.ignored_headers = Array.from(ignored);
  out.present_item_fields = Array.from(presentItem);
  out.present_stage_fields = Array.from(presentStage).map((k) => {
    const [stage_code, field] = k.split("|");
    return { stage_code, field: field as TocStageFieldKey };
  });
  out.dateIssues = audit.issues;
  return out;
}
