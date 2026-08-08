import type { WrtRow } from "@/lib/wrt/rows.functions";

export interface WrtColumnDef {
  key: string;
  label: string;
  width: number;
  /** Filter type — multi: value checklist, none: no filter */
  filter: "multi" | "none";
  /** Display string used by filters and export */
  get: (r: WrtRow) => string;
  /** Editable fields (existing scope: team · pic · eng) */
  edit?: "team" | "pic" | "eng";
}

/** Judgment values are stored canonically; screens show the English label only. */
export const WRT_JUDGMENT_LABEL: Record<string, string> = {
  "완료": "Completed",
  "정상": "On Track",
  "지연": "Delayed",
  "미착수": "Not Started",
  "미분류": "Unclassified",
  "제외": "Excluded",
};

export function wrtJudgmentLabel(v: string): string {
  return WRT_JUDGMENT_LABEL[v] ?? v;
}

function stageText(s: { label: string; round_no?: number | null } | null | undefined) {
  if (!s) return "";
  const base = s.label.replace(/\s*\(R\d\)\s*$/, "");
  return s.round_no ? `R${s.round_no} ${base}` : base;
}

export const WRT_COLUMNS: WrtColumnDef[] = [
  { key: "wrt_number", label: "WRT NUMBER", width: 250, filter: "none", get: (r) => r.wrt_number ?? "" },
  { key: "plot", label: "Plot", width: 70, filter: "multi", get: (r) => (r.plot ? `PLOT-${r.plot}` : "") },
  { key: "team", label: "Team", width: 80, filter: "multi", get: (r) => r.team ?? "", edit: "team" },
  { key: "pic", label: "PIC", width: 90, filter: "multi", get: (r) => r.pic ?? "", edit: "pic" },
  { key: "eng", label: "ENG", width: 90, filter: "multi", get: (r) => r.eng ?? "", edit: "eng" },
  { key: "judgment", label: "Status", width: 110, filter: "multi", get: (r) => wrtJudgmentLabel(r.judgment) },
  { key: "progress_pct", label: "Progress", width: 90, filter: "none", get: (r) => (r.progress_pct == null ? "" : `${r.progress_pct}%`) },
  { key: "active_round", label: "Round", width: 70, filter: "multi", get: (r) => `R${r.active_round}` },
  { key: "current_stage", label: "Current Stage", width: 150, filter: "multi", get: (r) => stageText(r.current_stage) },
  {
    key: "primary_delay",
    label: "Primary Delay",
    width: 170,
    filter: "multi",
    get: (r) => (r.primary_delay ? `${stageText(r.primary_delay)} · ${r.primary_delay.days}d` : ""),
  },
  { key: "latest_status_raw", label: "Latest Status", width: 110, filter: "multi", get: (r) => r.latest_status_raw ?? "" },
  { key: "is_final_approved", label: "Final Approved", width: 110, filter: "multi", get: (r) => (r.is_final_approved ? "A" : "") },
  { key: "dis", label: "DIS", width: 90, filter: "multi", get: (r) => r.dis ?? "" },
  { key: "service", label: "Service", width: 120, filter: "multi", get: (r) => r.service ?? "" },
  { key: "title", label: "Title", width: 280, filter: "none", get: (r) => r.title ?? "" },
  { key: "data_date", label: "Data Date", width: 100, filter: "multi", get: (r) => r.data_date ?? "" },
];

export const WRT_DEFAULT_ORDER = WRT_COLUMNS.map((c) => c.key);

export const WRT_DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  WRT_COLUMNS.map((c) => [c.key, !["dis", "service", "title", "data_date"].includes(c.key)]),
);

/** Editable scope — unchanged (date/stage columns stay import-owned) */
export const WRT_EDITABLE_FIELDS: Array<{ field: "team" | "pic" | "eng"; label: string }> = [
  { field: "team", label: "Team" },
  { field: "pic", label: "PIC" },
  { field: "eng", label: "ENG" },
];

/** Band full names used in the single-row header tooltip */
export const WRT_BAND_LABEL: Record<string, string> = {
  COMMERCIAL: "Commercial Stage",
  DRAFT_APPROVAL: "Draft Approval Stage",
  SUBMISSION: "Submission Stage",
};

export type WrtStageColumn = {
  key: string;
  stage_code: string;
  field: "ps" | "as" | "pf" | "af" | "fv";
  /** Header text — catalog short_code plus field suffix */
  code: string;
  /** Tooltip — band full name › stage full name — field */
  title: string;
  aconex: boolean;
};

const FIELD_SUFFIX: Record<string, { sfx: string; name: string }> = {
  ps_single: { sfx: "-PD", name: "Plan Date" },
  as_single: { sfx: "-AD", name: "Actual Date" },
  ps_range: { sfx: "-PS", name: "Plan Start" },
  as_range: { sfx: "-AS", name: "Actual Start" },
  pf_range: { sfx: "-PF", name: "Plan Finish" },
  af_range: { sfx: "-AF", name: "Actual Finish" },
};

/** Single-row header: one cell per stage field. Codes come from the catalog, never hardcoded. */
export function buildWrtStageColumns(
  catalog: Array<{
    stage_code: string;
    short_code: string;
    label: string;
    band: string;
    value_type: "flag" | "single" | "range";
    actual_authority: "HDEC" | "ACONEX";
  }>,
): WrtStageColumn[] {
  const out: WrtStageColumn[] = [];
  for (const s of catalog) {
    const band = WRT_BAND_LABEL[s.band] ?? s.band;
    const aconex = s.actual_authority === "ACONEX";
    const mk = (field: WrtStageColumn["field"], sfx: string, name: string) =>
      out.push({
        key: `${s.stage_code}|${field}`,
        stage_code: s.stage_code,
        field,
        code: `${s.short_code}${sfx}`,
        title: `${band} › ${s.label}${name ? ` — ${name}` : ""}${aconex && field === "as" ? " (Aconex)" : ""}`,
        aconex,
      });
    if (s.value_type === "flag") {
      mk("fv", "", "");
    } else if (s.value_type === "single") {
      mk("ps", FIELD_SUFFIX.ps_single.sfx, FIELD_SUFFIX.ps_single.name);
      mk("as", FIELD_SUFFIX.as_single.sfx, FIELD_SUFFIX.as_single.name);
    } else {
      mk("ps", FIELD_SUFFIX.ps_range.sfx, FIELD_SUFFIX.ps_range.name);
      mk("as", FIELD_SUFFIX.as_range.sfx, FIELD_SUFFIX.as_range.name);
      mk("pf", FIELD_SUFFIX.pf_range.sfx, FIELD_SUFFIX.pf_range.name);
      mk("af", FIELD_SUFFIX.af_range.sfx, FIELD_SUFFIX.af_range.name);
    }
  }
  return out;
}
