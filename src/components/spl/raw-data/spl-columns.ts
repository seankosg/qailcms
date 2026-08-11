import type { SplRow } from "@/lib/spl/rows.functions";

export interface SplColumnDef {
  key: string;
  label: string;
  width: number;
  filter: "multi" | "none";
  get: (r: SplRow) => string;
  edit?: "team" | "pic" | "eng" | "pic_po" | "eng_po";
}

/** Judgment values are stored canonically; screens show the English label only. */
export const SPL_JUDGMENT_LABEL: Record<string, string> = {
  "완료": "Completed",
  "정상": "On Track",
  "지연": "Delayed",
  "미착수": "Not Started",
  "미분류": "Unclassified",
  "제외": "Excluded",
};

export function splJudgmentLabel(v: string): string {
  return SPL_JUDGMENT_LABEL[v] ?? v;
}

export const SPL_COLUMNS: SplColumnDef[] = [
  { key: "spl_number", label: "SPL NUMBER", width: 230, filter: "multi", get: (r) => r.spl_number ?? "" },
  { key: "plot", label: "Plot", width: 70, filter: "multi", get: (r) => (r.plot ? `PLOT-${r.plot}` : "") },
  { key: "team", label: "Team", width: 80, filter: "multi", get: (r) => r.team ?? "", edit: "team" },
  { key: "judgment", label: "Status", width: 110, filter: "multi", get: (r) => splJudgmentLabel(r.judgment) },
  { key: "progress_pct", label: "Progress", width: 90, filter: "multi", get: (r) => (r.progress_pct == null ? "" : `${r.progress_pct}%`) },
  { key: "completed_stage", label: "Completed Stage", width: 150, filter: "multi", get: (r) => r.completed_stage?.label ?? "" },
  { key: "current_stage", label: "Current Stage", width: 150, filter: "multi", get: (r) => r.current_stage?.label ?? "" },
  {
    key: "primary_delay",
    label: "Primary Delay",
    width: 170,
    filter: "multi",
    get: (r) =>
      r.primary_delay
        ? `${r.primary_delay.short_code ? splStagePrefix(r.primary_delay.short_code) + " · " : ""}${r.primary_delay.label} · ${r.primary_delay.days}d`
        : "",
  },
  { key: "pic", label: "PIC", width: 90, filter: "multi", get: (r) => r.pic ?? "", edit: "pic" },
  { key: "eng", label: "ENG", width: 90, filter: "multi", get: (r) => r.eng ?? "", edit: "eng" },
  { key: "pic_po", label: "PIC PO", width: 90, filter: "multi", get: (r) => r.pic_po ?? "", edit: "pic_po" },
  { key: "eng_po", label: "ENG PO", width: 90, filter: "multi", get: (r) => r.eng_po ?? "", edit: "eng_po" },
  { key: "req_doc", label: "Req.Doc", width: 90, filter: "multi", get: (r) => `${r.req_doc_done}/${r.req_doc_total}` },
  {
    key: "ocs",
    label: "OCS",
    width: 90,
    filter: "multi",
    get: (r) => (r.ocs_total == null ? "" : `${r.ocs_total}/${r.ocs_pending ?? 0}`),
  },
  { key: "rsp", label: "RSP", width: 70, filter: "multi", get: (r) => (r.rsp_total == null ? "" : String(r.rsp_total)) },
  {
    key: "documents",
    label: "Documents",
    width: 100,
    filter: "multi",
    get: (r) => (r.document_total == null ? "" : String(r.document_total)),
  },
  { key: "data_date", label: "Data Date", width: 100, filter: "multi", get: (r) => r.data_date ?? "" },
  { key: "supplier", label: "Supplier", width: 140, filter: "multi", get: (r) => r.supplier ?? "" },
  { key: "latest_status", label: "Latest Status", width: 110, filter: "multi", get: (r) => r.latest_status ?? "" },
  { key: "dis", label: "DIS", width: 90, filter: "multi", get: (r) => r.dis ?? "" },
  { key: "service", label: "Service", width: 120, filter: "multi", get: (r) => r.service ?? "" },
  { key: "title", label: "Title", width: 280, filter: "multi", get: (r) => r.title ?? "" },
];

/**
 * 신규 사용자 기본 컬럼 순서.
 * 앞부분은 고정 지정, 나머지는 SPL_COLUMNS 정의 순서를 그대로 잇는다.
 * (기존 사용자의 저장된 순서는 초기화하지 않고, 누락된 신규 키만 뒤에 보충한다.)
 */
const SPL_LEAD_ORDER = [
  "spl_number",
  "ocs",
  "rsp",
  "documents",
  "plot",
  "team",
  "judgment",
  "progress_pct",
  "completed_stage",
  "current_stage",
  "primary_delay",
] as const;
export const SPL_DEFAULT_ORDER = [
  ...SPL_LEAD_ORDER.filter((k) => SPL_COLUMNS.some((c) => c.key === k)),
  ...SPL_COLUMNS.map((c) => c.key).filter(
    (k) => !(SPL_LEAD_ORDER as readonly string[]).includes(k),
  ),
];

export const SPL_DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  SPL_COLUMNS.map((c) => [c.key, !["supplier", "latest_status", "dis", "service", "title"].includes(c.key)]),
);

/** SPL team values are owned by the table CHECK constraint */
export const SPL_TEAM_OPTIONS = ["MECH", "ELEC", "PRJC"] as const;

export const SPL_EDITABLE_FIELDS: Array<{ field: "team" | "pic" | "eng" | "pic_po" | "eng_po"; label: string }> = [
  { field: "team", label: "Team" },
  { field: "pic", label: "PIC" },
  { field: "eng", label: "ENG" },
  { field: "pic_po", label: "PIC PO" },
  { field: "eng_po", label: "ENG PO" },
];

/**
 * Bulk Edit 필드 카탈로그 (TM Raw Data 의 Bulk Edit UI 와 동일 규격).
 * - base   : spl_items 컬럼 직접 쓰기
 * - derived: 서버 정본 산출값 → 목록에는 노출하되 선택 불가
 * 스테이지 컬럼은 카탈로그에서 동적으로 만들어 붙인다(`buildSplStageColumns`).
 */
export type SplBulkFieldKind = "base" | "stage" | "derived";

export interface SplBulkField {
  /** 표 컬럼 키와 동일 (파생/기본) 또는 `stage:<stage_code>|<field>` */
  key: string;
  label: string;
  kind: SplBulkFieldKind;
  group: string;
  inputType: "text" | "date" | "select";
  options?: string[];
  /** base 전용 — spl_items 컬럼명 */
  column?: string;
  /** stage 전용 */
  stage?: { stage_code: string; field: "ps" | "as" | "pf" | "af" | "fv" };
  /** 선택 불가 사유 (derived) */
  disabledReason?: string;
}

const BASE_BULK_FIELDS: SplBulkField[] = [
  { key: "team", label: "Team", kind: "base", group: "Basic", inputType: "select", options: [...SPL_TEAM_OPTIONS], column: "team" },
  { key: "pic", label: "PIC", kind: "base", group: "Basic", inputType: "text", column: "pic" },
  { key: "eng", label: "ENG", kind: "base", group: "Basic", inputType: "text", column: "eng" },
  { key: "pic_po", label: "PIC PO", kind: "base", group: "Basic", inputType: "text", column: "pic_po" },
  { key: "eng_po", label: "ENG PO", kind: "base", group: "Basic", inputType: "text", column: "eng_po" },
  { key: "plot", label: "Plot", kind: "base", group: "Basic", inputType: "text", column: "plot" },
  { key: "dis", label: "DIS", kind: "base", group: "Basic", inputType: "text", column: "dis" },
  { key: "service", label: "Service", kind: "base", group: "Basic", inputType: "text", column: "service" },
  { key: "title", label: "Title", kind: "base", group: "Basic", inputType: "text", column: "title" },
  { key: "supplier", label: "Supplier", kind: "base", group: "Basic", inputType: "text", column: "supplier" },
  { key: "latest_status", label: "Latest Status", kind: "base", group: "Basic", inputType: "text", column: "latest_status" },
  { key: "data_date", label: "Data Date", kind: "base", group: "Basic", inputType: "date", column: "data_date" },
];

const DERIVED_KEYS: Array<{ key: string; reason: string }> = [
  { key: "spl_number", reason: "고유 번호 — 일괄 변경 불가" },
  { key: "judgment", reason: "서버 정본 산출값" },
  { key: "progress_pct", reason: "서버 정본 산출값" },
  { key: "completed_stage", reason: "서버 정본 산출값" },
  { key: "current_stage", reason: "서버 정본 산출값" },
  { key: "primary_delay", reason: "서버 정본 산출값" },
  { key: "req_doc", reason: "스테이지 값에서 집계" },
  { key: "ocs", reason: "OCS 정본에서 집계" },
  { key: "rsp", reason: "RSP 정본에서 집계" },
  { key: "documents", reason: "문서 정본에서 집계" },
];

/** 표에 보이는 모든 컬럼을 Bulk Edit 목록으로 노출한다(파생은 비활성). */
export function buildSplBulkFields(stageCols: SplStageColumn[]): SplBulkField[] {
  const derived: SplBulkField[] = DERIVED_KEYS.map((d) => ({
    key: d.key,
    label: SPL_COLUMNS.find((c) => c.key === d.key)?.label ?? d.key,
    kind: "derived",
    group: "Derived (read-only)",
    inputType: "text",
    disabledReason: d.reason,
  }));
  const stage: SplBulkField[] = stageCols.map((sc) => ({
    key: `stage:${sc.key}`,
    label: `${sc.code}`,
    kind: "stage",
    group: `Stage — ${SPL_BAND_LABEL[sc.band] ?? sc.band}`,
    inputType: sc.field === "fv" ? "text" : "date",
    stage: { stage_code: sc.stage_code, field: sc.field },
  }));
  return [...BASE_BULK_FIELDS, ...stage, ...derived];
}

/** Band full names used in the single-row header tooltip */
export const SPL_BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Documents",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

export type SplStageColumn = {
  key: string;
  stage_code: string;
  field: "ps" | "as" | "pf" | "af" | "fv";
  code: string;
  title: string;
  aconex: boolean;
  /** Catalog band code — drives header tint (never hardcode per column key) */
  band: string;
  /** True on the first column of each band — draws the band divider */
  bandStart: boolean;
};

/** Header tint per band. Keys are catalog band codes. */
export const SPL_BAND_HEADER_CLASS: Record<string, string> = {
  REQUIRED_DOC: "bg-slate-200 dark:bg-slate-800",
  DOCUMENTATION: "bg-blue-100 dark:bg-blue-950",
  PO: "bg-violet-100 dark:bg-violet-950",
};

export function splBandHeaderClass(band: string): string {
  return SPL_BAND_HEADER_CLASS[band] ?? "bg-muted";
}

/** Single-row header: one cell per stage field. Codes come from the catalog, never hardcoded. */
export function buildSplStageColumns(
  catalog: Array<{
    stage_code: string;
    short_code: string;
    label: string;
    band: string;
    value_type: "flag" | "single" | "range";
    actual_authority: "HDEC" | "ACONEX";
  }>,
): SplStageColumn[] {
  const out: SplStageColumn[] = [];
  let prevBand: string | null = null;
  for (const s of catalog) {
    const band = SPL_BAND_LABEL[s.band] ?? s.band;
    const aconex = s.actual_authority === "ACONEX";
    const bandStartAt = out.length;
    const mk = (field: SplStageColumn["field"], sfx: string, name: string) =>
      out.push({
        key: `${s.stage_code}|${field}`,
        stage_code: s.stage_code,
        field,
        code: `${s.short_code}${sfx}`,
        title: `${band} › ${s.label}${name ? ` — ${name}` : ""}${aconex && field === "as" ? " (Aconex)" : ""}`,
        aconex,
        band: s.band,
        bandStart: false,
      });
    if (s.value_type === "flag") {
      mk("fv", "", "");
    } else if (s.value_type === "single") {
      mk("ps", "-PD", "Plan Date");
      mk("as", "-AD", "Actual Date");
    } else {
      mk("ps", "-PS", "Plan Start");
      mk("as", "-AS", "Actual Start");
      mk("pf", "-PF", "Plan Finish");
      mk("af", "-AF", "Actual Finish");
    }
    if (s.band !== prevBand && out[bandStartAt]) {
      out[bandStartAt].bandStart = true;
      prevBand = s.band;
    }
  }
  return out;
}
