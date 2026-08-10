// SM 대시보드 매트릭스 — HO Planned Date (셀별 MAX) 조립 유틸
// defect_snag_ho_dates_json RPC 결과를 매트릭스 축(블록·빌딩·층·열)에 맞춰 최댓값으로 접는다.
import {
  classifyBuilding,
  normalizeRoomGroup,
  parseLevel,
  UNASSIGNED_BUILDING_LABEL,
  VIP_BUILDING_LABEL,
  type BlockKey,
} from "./dashboard-shape";

export type HoDateRawRow = {
  building: string | null;
  level_name: string | null;
  room_group: string | null;
  room: string | null;
  subcontractor: string | null;
  ho_max: string | null;
};

/** 축별 MAX(planned_ho_date) 조회 맵 */
export type HoDateMap = {
  /** 셀 = 블록 · 빌딩 · 층 · 열 */
  cell: (kind: BlockKey, building: string, levelDisp: string, col: string) => string | null;
  /** 행(층) 전체 최댓값 — Level HO */
  row: (kind: BlockKey, building: string, levelDisp: string) => string | null;
  /** 빌딩 소계 행 */
  building: (kind: BlockKey, building: string) => string | null;
  /** 열(Room Group) 전체 최댓값 — Column Total 행 */
  col: (kind: BlockKey, col: string) => string | null;
  /** 블록 전체 최댓값 */
  block: (kind: BlockKey) => string | null;
};

export const EMPTY_HO_DATE_MAP: HoDateMap = {
  cell: () => null,
  row: () => null,
  building: () => null,
  col: () => null,
  block: () => null,
};

function maxInto(m: Map<string, string>, key: string, v: string) {
  const cur = m.get(key);
  if (!cur || v > cur) m.set(key, v);
}

export function buildHoDateMap(rawRows: HoDateRawRow[]): HoDateMap {
  const m = new Map<string, string>();

  for (const r of rawRows) {
    const v = (r.ho_max ?? "").slice(0, 10);
    if (!v) continue;

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

    maxInto(m, `c|${kind}|${buildingLabel}|${levelDisp}|${col}`, v);
    maxInto(m, `r|${kind}|${buildingLabel}|${levelDisp}`, v);
    maxInto(m, `b|${kind}|${buildingLabel}`, v);
    maxInto(m, `g|${kind}|${col}`, v);
    maxInto(m, `k|${kind}`, v);
  }

  const get = (k: string) => m.get(k) ?? null;
  return {
    cell: (kind, building, levelDisp, col) => get(`c|${kind}|${building}|${levelDisp}|${col}`),
    row: (kind, building, levelDisp) => get(`r|${kind}|${building}|${levelDisp}`),
    building: (kind, building) => get(`b|${kind}|${building}`),
    col: (kind, col) => get(`g|${kind}|${col}`),
    block: (kind) => get(`k|${kind}`),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO(yyyy-mm-dd) → dd/mmm (예: 23/Aug). 값이 없으면 '–' */
export function formatHoDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "–";
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return "–";
  return `${m[3]}/${MONTHS[mm - 1]}`;
}
