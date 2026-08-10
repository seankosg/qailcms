// SM 대시보드 매트릭스 — Each Date (스테이지별 계획일/실적일 MAX) 조립 유틸
// defect_snag_stage_dates_json RPC 결과를 매트릭스 축(블록·빌딩·층·열) × 스테이지 × 팀으로 접는다.
import {
  classifyBuilding,
  normalizeRoomGroup,
  normalizeTeam,
  parseLevel,
  UNASSIGNED_BUILDING_LABEL,
  VIP_BUILDING_LABEL,
  type BlockKey,
  type StageMetric,
  type TeamKey,
} from "./dashboard-shape";

export type StageDateRawRow = {
  building: string | null;
  level_name: string | null;
  room_group: string | null;
  room: string | null;
  subcontractor: string | null;
  team: string | null;
  p_rect: string | null;
  p_pre: string | null;
  p_dar: string | null;
  p_closed: string | null;
  p_ho: string | null;
  a_rect: string | null;
  a_pre: string | null;
  a_dar: string | null;
  a_closed: string | null;
  a_ho: string | null;
};

/** planned·actual 두 종류의 MAX 날짜를 축별로 조회 */
export type StageDateKindKey = "planned" | "actual";

export type StageDateMap = {
  cell: (
    kind: BlockKey,
    building: string,
    levelDisp: string,
    col: string,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
  row: (
    kind: BlockKey,
    building: string,
    levelDisp: string,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
  building: (
    kind: BlockKey,
    building: string,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
  /** 빌딩 소계 행 × 특정 열 */
  buildingCol: (
    kind: BlockKey,
    building: string,
    col: string,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
  col: (
    kind: BlockKey,
    col: string,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
  block: (
    kind: BlockKey,
    stage: StageMetric,
    team: TeamKey,
    which: StageDateKindKey,
  ) => string | null;
};

export const EMPTY_STAGE_DATE_MAP: StageDateMap = {
  cell: () => null,
  row: () => null,
  building: () => null,
  buildingCol: () => null,
  col: () => null,
  block: () => null,
};

const STAGE_FIELDS: Array<{ stage: StageMetric; planned: keyof StageDateRawRow; actual: keyof StageDateRawRow }> = [
  { stage: "rect", planned: "p_rect", actual: "a_rect" },
  { stage: "pre", planned: "p_pre", actual: "a_pre" },
  { stage: "dar", planned: "p_dar", actual: "a_dar" },
  { stage: "closed", planned: "p_closed", actual: "a_closed" },
  { stage: "ho", planned: "p_ho", actual: "a_ho" },
];

function maxInto(m: Map<string, string>, key: string, v: string) {
  const cur = m.get(key);
  if (!cur || v > cur) m.set(key, v);
}

export function buildStageDateMap(rawRows: StageDateRawRow[]): StageDateMap {
  const m = new Map<string, string>();

  for (const r of rawRows) {
    const team = normalizeTeam(r.team);
    if (!team) continue;

    const bld = classifyBuilding(r.building);
    const lvl = parseLevel(r.level_name);
    let kind: BlockKey;
    let buildingLabel: string;
    let levelDisp = lvl.kind === "unknown" ? "Level ?" : `Level ${lvl.key}`;
    let col: string;

    if (bld.kind === "liftcabin") {
      kind = "liftcabin";
      buildingLabel = "LIFT CABIN";
      levelDisp = (r.room ?? "").trim() || "N/A";
      col = (r.subcontractor ?? "").trim() || "N/A";
    } else if (bld.kind === "lg") {
      kind = "lg";
      buildingLabel = "LG";
      levelDisp = "LG";
      col = normalizeRoomGroup(r.room_group);
    } else if (bld.kind === "basement") {
      kind = "basement";
      buildingLabel = "BSM";
      col = normalizeRoomGroup(r.room_group);
    } else if (bld.kind === "vip") {
      kind = "vip";
      buildingLabel = VIP_BUILDING_LABEL;
      col = (r.room_group ?? "").trim() || "N/A";
    } else if (bld.kind === "tower") {
      kind = "tower";
      buildingLabel = "Tower";
      col = normalizeRoomGroup(r.room_group);
    } else if (bld.kind === "podium") {
      kind = "podium";
      buildingLabel = bld.label;
      col = normalizeRoomGroup(r.room_group);
    } else if (bld.kind === "unassigned") {
      kind = "unassigned";
      buildingLabel = UNASSIGNED_BUILDING_LABEL;
      col = normalizeRoomGroup(r.room_group);
    } else {
      kind = "podium";
      buildingLabel = "Others";
      col = normalizeRoomGroup(r.room_group);
    }

    for (const f of STAGE_FIELDS) {
      for (const which of ["planned", "actual"] as const) {
        const raw = r[which === "planned" ? f.planned : f.actual];
        const v = (raw ?? "").slice(0, 10);
        if (!v) continue;
        const sfx = `${f.stage}|${team}|${which}`;
        maxInto(m, `c|${kind}|${buildingLabel}|${levelDisp}|${col}|${sfx}`, v);
        maxInto(m, `r|${kind}|${buildingLabel}|${levelDisp}|${sfx}`, v);
        maxInto(m, `bc|${kind}|${buildingLabel}|${col}|${sfx}`, v);
        maxInto(m, `b|${kind}|${buildingLabel}|${sfx}`, v);
        maxInto(m, `g|${kind}|${col}|${sfx}`, v);
        maxInto(m, `k|${kind}|${sfx}`, v);
      }
    }
  }

  const get = (k: string) => m.get(k) ?? null;
  return {
    cell: (kind, building, levelDisp, col, stage, team, which) =>
      get(`c|${kind}|${building}|${levelDisp}|${col}|${stage}|${team}|${which}`),
    row: (kind, building, levelDisp, stage, team, which) =>
      get(`r|${kind}|${building}|${levelDisp}|${stage}|${team}|${which}`),
    buildingCol: (kind, building, col, stage, team, which) =>
      get(`bc|${kind}|${building}|${col}|${stage}|${team}|${which}`),
    building: (kind, building, stage, team, which) =>
      get(`b|${kind}|${building}|${stage}|${team}|${which}`),
    col: (kind, col, stage, team, which) => get(`g|${kind}|${col}|${stage}|${team}|${which}`),
    block: (kind, stage, team, which) => get(`k|${kind}|${stage}|${team}|${which}`),
  };
}