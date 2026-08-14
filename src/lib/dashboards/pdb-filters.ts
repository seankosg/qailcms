/**
 * Project Dashboard(PDB) 모듈별 필터 설정.
 * 값은 public.pdb_module_filters 에 모듈당 1행(jsonb)으로 저장된다.
 * 계산식은 각 모듈 정본 훅 그대로이며, 여기서는 훅 인자만 결정한다.
 */
export type PdbModule = "tm" | "sm" | "abd" | "spl";

export interface PdbTmFilters {
  taskScope: "main" | "sub" | "all";
  disciplines: string[];
  workType: string;
  delayFilter: string;
  bucket: "day" | "week" | "month";
  /** 차트 시작일(ISO). null 이면 오늘 −14일 */
  startDate: string | null;
}

export interface PdbSmFilters {
  teams: string[];
  roomGroups: string[];
  buildings: string[];
  stage: string;
  planMode: "baseline" | "remaining";
  bucket: "day" | "week" | "month";
  unit: "cnt" | "pct";
  startDate: string | null;
}

export interface PdbAbdFilters {
  teams: string[];
  /** S-Curve/매트릭스에 표시할 스테이지. 빈 배열이면 전체 */
  stages: string[];
  /** KPI 카드(진도·지연) 산출 기준 스테이지 */
  kpiStage: string;
  planMode: "baseline" | "remaining";
  bucket: "day" | "week" | "month";
  startDate: string | null;
}

export interface PdbSplFilters {
  teams: string[];
  /** 표시할 밴드. 빈 배열이면 전체(Required Doc · Documentation · PO) */
  bands: string[];
  planMode: "baseline" | "remaining";
  bucket: "day" | "week" | "month";
  /** 차트 표시 창(기준일 ±일수) */
  rangeDays: number;
}

export interface PdbFilters {
  tm: PdbTmFilters;
  sm: PdbSmFilters;
  abd: PdbAbdFilters;
  spl: PdbSplFilters;
}

export const PDB_DEFAULTS: PdbFilters = {
  tm: {
    taskScope: "sub",
    disciplines: [],
    workType: "all",
    delayFilter: "all",
    bucket: "week",
    startDate: null,
  },
  sm: {
    teams: [],
    roomGroups: [],
    buildings: [],
    stage: "closure",
    planMode: "baseline",
    bucket: "week",
    unit: "cnt",
    startDate: null,
  },
  abd: {
    teams: [],
    stages: [],
    kpiStage: "approval",
    planMode: "baseline",
    bucket: "week",
    startDate: null,
  },
  spl: {
    teams: [],
    bands: [],
    planMode: "baseline",
    bucket: "week",
    rangeDays: 120,
  },
};

function strArr(v: unknown, fb: string[]) {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fb;
}
function str<T extends string>(v: unknown, fb: T): T {
  return typeof v === "string" && v ? (v as T) : fb;
}
function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function num(v: unknown, fb: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

export function normalizePdbFilters(module: PdbModule, raw: unknown): PdbFilters[PdbModule] {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (module === "tm") {
    const d = PDB_DEFAULTS.tm;
    return {
      taskScope: str(o.taskScope, d.taskScope),
      disciplines: strArr(o.disciplines, d.disciplines),
      workType: str(o.workType, d.workType),
      delayFilter: str(o.delayFilter, d.delayFilter),
      bucket: str(o.bucket, d.bucket),
      startDate: dateOrNull(o.startDate),
    } satisfies PdbTmFilters;
  }
  if (module === "sm") {
    const d = PDB_DEFAULTS.sm;
    return {
      teams: strArr(o.teams, d.teams),
      roomGroups: strArr(o.roomGroups, d.roomGroups),
      buildings: strArr(o.buildings, d.buildings),
      stage: str(o.stage, d.stage),
      planMode: str(o.planMode, d.planMode),
      bucket: str(o.bucket, d.bucket),
      unit: str(o.unit, d.unit),
      startDate: dateOrNull(o.startDate),
    } satisfies PdbSmFilters;
  }
  if (module === "spl") {
    const s = PDB_DEFAULTS.spl;
    return {
      teams: strArr(o.teams, s.teams),
      bands: strArr(o.bands, s.bands),
      planMode: str(o.planMode, s.planMode),
      bucket: str(o.bucket, s.bucket),
      rangeDays: num(o.rangeDays, s.rangeDays),
    } satisfies PdbSplFilters;
  }
  const d = PDB_DEFAULTS.abd;
  return {
    teams: strArr(o.teams, d.teams),
    stages: strArr(o.stages, d.stages),
    kpiStage: str(o.kpiStage, d.kpiStage),
    planMode: str(o.planMode, d.planMode),
    bucket: str(o.bucket, d.bucket),
    startDate: dateOrNull(o.startDate),
  } satisfies PdbAbdFilters;
}

const BUCKET_LABEL: Record<string, string> = { day: "일", week: "주", month: "월" };

function listLabel(a: string[]) {
  return a.length === 0 ? "All" : a.length <= 3 ? a.join(", ") : `${a.length} selected`;
}

/** 모듈 블록 상단에 노출할 "적용된 세팅" 칩 목록 */
export function pdbFilterChips(
  module: PdbModule,
  f: PdbFilters[PdbModule],
  stageLabel?: (s: string) => string,
): Array<{ label: string; value: string }> {
  if (module === "tm") {
    const t = f as PdbTmFilters;
    return [
      { label: "Scope", value: t.taskScope === "sub" ? "Sub" : t.taskScope === "main" ? "Main" : "All" },
      { label: "Team", value: listLabel(t.disciplines) },
      { label: "Work Type", value: t.workType === "all" ? "All" : t.workType },
      { label: "Delay", value: t.delayFilter === "all" ? "전체" : t.delayFilter === "delayed" ? "지연만" : "악화만" },
      { label: "Bucket", value: BUCKET_LABEL[t.bucket] ?? t.bucket },
      { label: "차트 시작", value: t.startDate ?? "기본(−14일)" },
    ];
  }
  if (module === "sm") {
    const s = f as PdbSmFilters;
    return [
      { label: "Team", value: listLabel(s.teams) },
      { label: "Room", value: listLabel(s.roomGroups) },
      { label: "Building", value: listLabel(s.buildings) },
      { label: "Stage", value: stageLabel ? stageLabel(s.stage) : s.stage },
      { label: "Plan", value: s.planMode === "remaining" ? "Remaining" : "Baseline" },
      { label: "단위", value: s.unit === "pct" ? "%" : "건수" },
      { label: "Bucket", value: BUCKET_LABEL[s.bucket] ?? s.bucket },
      { label: "차트 시작", value: s.startDate ?? "기본(−14일)" },
    ];
  }
  const a = f as PdbAbdFilters;
  if (module === "spl") {
    const s = f as PdbSplFilters;
    return [
      { label: "Team", value: listLabel(s.teams) },
      { label: "Band", value: listLabel(s.bands) },
      { label: "Plan", value: s.planMode === "remaining" ? "Remaining" : "Baseline" },
      { label: "Bucket", value: BUCKET_LABEL[s.bucket] ?? s.bucket },
      { label: "Range", value: `±${s.rangeDays}d` },
    ];
  }
  return [
    { label: "Team", value: listLabel(a.teams) },
    { label: "Stage", value: listLabel(a.stages) },
    { label: "KPI Stage", value: stageLabel ? stageLabel(a.kpiStage) : a.kpiStage },
    { label: "Plan", value: a.planMode === "remaining" ? "Remaining" : "Baseline" },
    { label: "Bucket", value: BUCKET_LABEL[a.bucket] ?? a.bucket },
    { label: "차트 시작", value: a.startDate ?? "기본(−14일)" },
  ];
}
