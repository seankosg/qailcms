import type { WrtRow } from "@/lib/wrt/rows.functions";

export interface WrtColumnDef {
  key: string;
  label: string;
  width: number;
  /** 필터 유형 — multi: 값 목록 체크박스, none: 필터 없음 */
  filter: "multi" | "none";
  /** 필터/내보내기용 표시 문자열 */
  get: (r: WrtRow) => string;
  /** 편집 가능 필드 (기존 범위: team · pic · eng) */
  edit?: "team" | "pic" | "eng";
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
  { key: "judgment", label: "판정", width: 100, filter: "multi", get: (r) => r.judgment },
  { key: "progress_pct", label: "진척률", width: 90, filter: "none", get: (r) => (r.progress_pct == null ? "" : `${r.progress_pct}%`) },
  { key: "active_round", label: "Round", width: 70, filter: "multi", get: (r) => `R${r.active_round}` },
  { key: "current_stage", label: "현재 단계", width: 150, filter: "multi", get: (r) => stageText(r.current_stage) },
  {
    key: "primary_delay",
    label: "대표 지연",
    width: 170,
    filter: "multi",
    get: (r) => (r.primary_delay ? `${stageText(r.primary_delay)} · ${r.primary_delay.days}일` : ""),
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

/** 편집 허용 범위 — 기존과 동일 (날짜·단계 컬럼은 임포트 정본) */
export const WRT_EDITABLE_FIELDS: Array<{ field: "team" | "pic" | "eng"; label: string }> = [
  { field: "team", label: "Team" },
  { field: "pic", label: "PIC" },
  { field: "eng", label: "ENG" },
];