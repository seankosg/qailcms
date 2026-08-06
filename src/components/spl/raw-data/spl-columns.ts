import type { SplRow } from "@/lib/spl/rows.functions";

export interface SplColumnDef {
  key: string;
  label: string;
  width: number;
  filter: "multi" | "none";
  get: (r: SplRow) => string;
  edit?: "team" | "pic" | "eng" | "pic_po" | "eng_po";
}

export const SPL_COLUMNS: SplColumnDef[] = [
  { key: "spl_number", label: "SPL NUMBER", width: 230, filter: "none", get: (r) => r.spl_number ?? "" },
  { key: "plot", label: "Plot", width: 70, filter: "multi", get: (r) => (r.plot ? `PLOT-${r.plot}` : "") },
  { key: "team", label: "Team", width: 80, filter: "multi", get: (r) => r.team ?? "", edit: "team" },
  { key: "judgment", label: "판정", width: 100, filter: "multi", get: (r) => r.judgment },
  { key: "progress_pct", label: "진척률", width: 90, filter: "none", get: (r) => (r.progress_pct == null ? "" : `${r.progress_pct}%`) },
  { key: "current_stage", label: "현재 단계", width: 150, filter: "multi", get: (r) => r.current_stage?.label ?? "" },
  {
    key: "primary_delay",
    label: "대표 지연",
    width: 170,
    filter: "multi",
    get: (r) => (r.primary_delay ? `${r.primary_delay.label} · ${r.primary_delay.days}일` : ""),
  },
  { key: "pic", label: "PIC", width: 90, filter: "multi", get: (r) => r.pic ?? "", edit: "pic" },
  { key: "eng", label: "ENG", width: 90, filter: "multi", get: (r) => r.eng ?? "", edit: "eng" },
  { key: "pic_po", label: "PIC PO", width: 90, filter: "multi", get: (r) => r.pic_po ?? "", edit: "pic_po" },
  { key: "eng_po", label: "ENG PO", width: 90, filter: "multi", get: (r) => r.eng_po ?? "", edit: "eng_po" },
  { key: "req_doc", label: "Req.Doc", width: 90, filter: "none", get: (r) => `${r.req_doc_done}/${r.req_doc_total}` },
  { key: "data_date", label: "Data Date", width: 100, filter: "multi", get: (r) => r.data_date ?? "" },
  { key: "supplier", label: "Supplier", width: 140, filter: "multi", get: (r) => r.supplier ?? "" },
  { key: "latest_status", label: "Latest Status", width: 110, filter: "multi", get: (r) => r.latest_status ?? "" },
  { key: "dis", label: "DIS", width: 90, filter: "multi", get: (r) => r.dis ?? "" },
  { key: "service", label: "Service", width: 120, filter: "multi", get: (r) => r.service ?? "" },
  { key: "title", label: "Title", width: 280, filter: "none", get: (r) => r.title ?? "" },
];

export const SPL_DEFAULT_ORDER = SPL_COLUMNS.map((c) => c.key);

export const SPL_DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  SPL_COLUMNS.map((c) => [c.key, !["supplier", "latest_status", "dis", "service", "title"].includes(c.key)]),
);

/** SPL team 은 테이블 CHECK 값 정본 */
export const SPL_TEAM_OPTIONS = ["MECH", "ELEC", "PRJC"] as const;

export const SPL_EDITABLE_FIELDS: Array<{ field: "team" | "pic" | "eng" | "pic_po" | "eng_po"; label: string }> = [
  { field: "team", label: "Team" },
  { field: "pic", label: "PIC" },
  { field: "eng", label: "ENG" },
  { field: "pic_po", label: "PIC PO" },
  { field: "eng_po", label: "ENG PO" },
];