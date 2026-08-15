/** Demob Plan 공통 타입·상수. 정본은 RPC `public.org_demob_plan()`. */
export const DEMOB_MODULES = ["tm", "sm", "abd", "spl", "wrt"] as const;
export type DemobModule = (typeof DEMOB_MODULES)[number];

export const MODULE_LABEL: Record<DemobModule, string> = {
  tm: "TM",
  sm: "SM",
  abd: "ABD",
  spl: "SPL",
  wrt: "WRT",
};

/** 모듈 막대 색 — 각 모듈 화면에서 쓰는 계열과 맞춘 고정 팔레트. */
export const MODULE_BAR: Record<DemobModule, string> = {
  tm: "bg-sky-500",
  sm: "bg-amber-500",
  abd: "bg-violet-500",
  spl: "bg-emerald-500",
  wrt: "bg-rose-500",
};

export const MODULE_RAW_ROUTE: Record<DemobModule, string> = {
  tm: "/closure/task-management/raw-data",
  sm: "/closure/snag-management/raw-data",
  abd: "/closure/abd/raw-data",
  spl: "/closure/spare-part/raw-data",
  wrt: "/closure/warranty/raw-data",
};

export interface DemobModuleCell {
  start: string | null;
  end: string | null;
  count: number;
}

export interface DemobRow {
  nn: string;
  pic_name: string;
  team: string | null;
  team_sort: number;
  in_master: boolean;
  first_date: string | null;
  demob_date: string | null;
  per_module: Partial<Record<DemobModule, DemobModuleCell>>;
}

export interface DemobPayload {
  generated_at: string;
  rows: DemobRow[];
}
