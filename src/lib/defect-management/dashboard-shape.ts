// Snag Dashboard 축 정규화 · 집계 유틸
// 매트릭스 데이터: `defect_snag_dashboard_matrix` RPC의 GROUP BY 결과를 소비

export type MatrixRawRow = {
  plan_group: string | null;
  building: string | null;
  level_name: string | null;
  room_group: string | null;
  /** LIFT CABIN 블록 전용 세로축 (그 외 블록은 null) */
  room: string | null;
  /** LIFT CABIN 블록 전용 가로축 (그 외 블록은 null) */
  subcontractor: string | null;
  team: string | null;
  status_raw: string | null;
  cnt: number;
  rect_cnt: number;
  closed_cnt: number;
};

// 팀 분해 통계 — 정본(_snag_done_asof: 자기 실적일 ≤ as-of) 기준 rect/closed
export type TeamStat = { issued: number; rect: number; closed: number };

export type Stats = {
  open: number;
  rectified: number;
  reopen: number;
  closed: number;
  issued: number;
  closurePct: number | null; // null when issued=0
  byTeam: Record<TeamKey, TeamStat>;
};

// ── Plot ──────────────────────────────────────────────────────────────
export type PlotKey = "C" | "D";

export function planGroupsForPlot(plot: PlotKey): string[] {
  return plot === "C" ? ["Plot C", "Tower 3"] : ["Plot D", "Tower 4"];
}

// ── Teams ─────────────────────────────────────────────────────────────
export const ALL_TEAMS = ["ARCH", "MECH", "ELEC"] as const;
export type TeamKey = (typeof ALL_TEAMS)[number];

// 매트릭스 팀 열 표시 순서 (지시: Elec · Mech · Arch)
export const TEAM_COL_ORDER = ["ELEC", "MECH", "ARCH"] as const;

export function normalizeTeam(v: string | null | undefined): TeamKey | null {
  const s = (v ?? "").trim().toUpperCase();
  return (ALL_TEAMS as readonly string[]).includes(s) ? (s as TeamKey) : null;
}

export function emptyTeamStats(): Record<TeamKey, TeamStat> {
  return {
    ARCH: { issued: 0, rect: 0, closed: 0 },
    MECH: { issued: 0, rect: 0, closed: 0 },
    ELEC: { issued: 0, rect: 0, closed: 0 },
  };
}

export const EMPTY_STATS: Stats = {
  open: 0,
  rectified: 0,
  reopen: 0,
  closed: 0,
  issued: 0,
  closurePct: null,
  byTeam: emptyTeamStats(),
};

// ── Room Group (열) ──────────────────────────────────────────────────
export const ROOM_GROUP_ORDER = [
  "TENANT",
  "BOH",
  "FOH",
  "STAIRCASE",
  "LIFT",
  "CARPARK",
  "CARPARK RAMP",
  "CORRIDOR",
  "FACADE",
  "LANDSCAPE",
  "N/A",
] as const;

// LG (Lower Ground) 블록 전용 열 — building='LG' 행의 room_group 값
export const LG_ROOM_GROUPS = [
  "Podium 1",
  "Podium 2",
  "Podium 3",
  "Podium 4",
  "Podium 5",
] as const;

export const ALL_ROOM_GROUPS = [...ROOM_GROUP_ORDER, ...LG_ROOM_GROUPS] as const;

export type RoomGroupCol = (typeof ALL_ROOM_GROUPS)[number];
export type LgRoomGroupCol = (typeof LG_ROOM_GROUPS)[number];

export function isLgRoomGroup(v: string): v is LgRoomGroupCol {
  return (LG_ROOM_GROUPS as readonly string[]).includes(v);
}

export function normalizeRoomGroup(v: string | null | undefined): RoomGroupCol {
  const s = (v ?? "").trim().toUpperCase();
  if (!s) return "N/A";
  const pm = /^PODIUM\s+([1-5])$/.exec(s);
  if (pm) return `Podium ${pm[1]}` as RoomGroupCol;
  // 'LIFT CABIN' / 'LIFT LOBBY' 등 LIFT 계열 표기는 LIFT 열로 통합
  if (/^LIFT\b/.test(s)) return "LIFT";
  const hit = (ROOM_GROUP_ORDER as readonly string[]).find((k) => k.toUpperCase() === s);
  return (hit as RoomGroupCol) ?? "N/A";
}

/** 카드 드릴다운용 — 정규화 열 → raw-data 필터에 넘길 원본 room_group 값 집합 */
export function roomGroupSourceValues(col: string, rawValues: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const v of rawValues) {
    if (normalizeRoomGroup(v) !== col) continue;
    const t = (v ?? "").trim();
    out.add(t ? t : "__EMPTY__");
  }
  return Array.from(out);
}

// ── Level ─────────────────────────────────────────────────────────────
// 지하: Level B1, Level B2, Level B3, Level B4, Level LG
// 지상: Level 1 ~ Level 71
// null/기타: "Unknown"

export type LevelKind = "basement" | "ground" | "unknown";

export function parseLevel(v: string | null | undefined): { kind: LevelKind; key: string; sortIdx: number } {
  const s = (v ?? "").trim();
  if (!s) return { kind: "unknown", key: "Unknown", sortIdx: -1 };
  const m = /^Level\s+(.+)$/i.exec(s);
  const inner = (m ? m[1] : s).trim().toUpperCase();
  // 지하 우선
  if (inner === "LG") return { kind: "basement", key: "LG", sortIdx: 0 };
  const bm = /^B([1-4])$/.exec(inner);
  if (bm) return { kind: "basement", key: `B${bm[1]}`, sortIdx: Number(bm[1]) };
  const nm = /^(\d+)$/.exec(inner);
  if (nm) return { kind: "ground", key: nm[1], sortIdx: Number(nm[1]) };
  return { kind: "unknown", key: s, sortIdx: -1 };
}

export function levelDisplay(kind: LevelKind, key: string): string {
  if (kind === "basement") return `Level ${key}`;
  if (kind === "ground") return `Level ${key}`;
  return key;
}

// 지상 정렬: 상 → 하 (큰 숫자가 먼저)
export function compareGroundLevelDesc(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  return nb - na;
}

// 지하 정렬: LG → B1 → B2 → B3 → B4
export const BASEMENT_ORDER = ["LG", "B1", "B2", "B3", "B4"];

// ── Building ─────────────────────────────────────────────────────────
export type BlockKind = "tower" | "podium" | "lg" | "basement" | "liftcabin";

// 원본 building 값 → 정규화된 building 라벨 (표시용). Tower는 하나로 모음.
export function classifyBuilding(b: string | null | undefined): {
  kind: BlockKind | "unknown";
  label: string;
} {
  const s = (b ?? "").trim();
  if (!s) return { kind: "unknown", label: "Others" };
  // LIFT CABIN = 독립 블록 (세로축 room · 가로축 subcontractor)
  if (/^LIFT\s*CABIN$/i.test(s)) return { kind: "liftcabin", label: "LIFT CABIN" };
  // LG = Lower Ground 독립 블록. level_name 의 'Level LG' 와 무관.
  if (/^LG$/i.test(s)) return { kind: "lg", label: "LG" };
  if (/^Tower(\s+4)?$/i.test(s)) return { kind: "tower", label: "Tower" };
  if (/^Podium$/i.test(s)) return { kind: "podium", label: "Podium" };
  const pm = /^Podium\s+([1-4])$/i.exec(s);
  if (pm) return { kind: "podium", label: `Podium ${pm[1]}` };
  return { kind: "unknown", label: "Others" };
}

export const PODIUM_ORDER = ["Podium", "Podium 1", "Podium 2", "Podium 3", "Podium 4"];

/** LIFT CABIN Room 자연 정렬 — 접두어 그룹 → 숫자 오름차순 */
export function compareRoomNatural(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(.*?)(\d+)\s*$/.exec(v.trim());
    return m ? { prefix: m[1].trim().toUpperCase(), num: Number(m[2]) } : { prefix: v.trim().toUpperCase(), num: -1 };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  return pa.num - pb.num;
}

// ── Status 매칭 ──────────────────────────────────────────────────────
export function statusToStatKey(s: string | null | undefined): keyof Stats | null {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "open") return "open";
  if (v === "rectified") return "rectified";
  if (v === "re-opened" || v === "re-open" || v === "reopen" || v === "reopened") return "reopen";
  if (v === "closed") return "closed";
  return null;
}

export function addRow(stats: Stats, row: MatrixRawRow): void {
  const key = statusToStatKey(row.status_raw);
  if (key) {
    (stats as any)[key] += row.cnt;
    stats.issued += row.cnt;
    stats.closurePct = stats.issued > 0 ? stats.closed / stats.issued : null;
  }
  const team = normalizeTeam(row.team);
  if (team) {
    const t = stats.byTeam[team];
    t.issued += row.cnt;
    t.rect += row.rect_cnt;
    t.closed += row.closed_cnt;
  }
}

export function mergeStats(target: Stats, src: Stats): void {
  target.open += src.open;
  target.rectified += src.rectified;
  target.reopen += src.reopen;
  target.closed += src.closed;
  target.issued += src.issued;
  target.closurePct = target.issued > 0 ? target.closed / target.issued : null;
  for (const t of ALL_TEAMS) {
    target.byTeam[t].issued += src.byTeam[t].issued;
    target.byTeam[t].rect += src.byTeam[t].rect;
    target.byTeam[t].closed += src.byTeam[t].closed;
  }
}

export function newStats(): Stats {
  return { open: 0, rectified: 0, reopen: 0, closed: 0, issued: 0, closurePct: null, byTeam: emptyTeamStats() };
}

// ── 병목 팀 판정 ──────────────────────────────────────────────────────
// 각 셀에서 팀별 비율(Rect% 또는 Closed%) 최저 팀이 차상위 팀보다
// gapPp(기본 15%p) 이상 뒤처지면 병목으로 강조.
export const BOTTLENECK_GAP_PP = 15;

export function bottleneckTeam(
  byTeam: Record<TeamKey, TeamStat>,
  metric: "rect" | "closed",
  gapPp: number = BOTTLENECK_GAP_PP,
): TeamKey | null {
  const entries = (TEAM_COL_ORDER as readonly TeamKey[])
    .filter((t) => byTeam[t].issued > 0)
    .map((t) => ({ team: t, pct: (byTeam[t][metric] / byTeam[t].issued) * 100 }));
  if (entries.length < 2) return null;
  entries.sort((a, b) => a.pct - b.pct);
  const lowest = entries[0];
  const next = entries[1];
  if (next.pct - lowest.pct >= gapPp) return lowest.team;
  return null;
}

// ── 매트릭스 형태 ────────────────────────────────────────────────────
export type CellKey = string; // `${building}||${levelDisp}||${roomGroup}`

export type BlockKey = "tower" | "podium" | "lg" | "basement" | "liftcabin";

export type MatrixRow = {
  building: string;
  levelDisp: string;
  levelKind: LevelKind;
  cells: Record<string, Stats>;
  rowTotal: Stats;
};

export type MatrixBlock = {
  kind: BlockKey;
  title: string;
  rows: MatrixRow[]; // 정렬 완료
  /** 이 블록이 렌더링할 열 키 (일반 블록 = ROOM_GROUP_ORDER, LG 블록 = Podium N) */
  columnKeys: string[];
  colTotals: Record<string, Stats>;
  /** 좌측 고정 축 라벨 (일반 = Building/Level, LIFT CABIN = Block/Room) */
  rowAxis: { primary: string; secondary: string };
  /** 상단 1단 축 라벨 (일반 = Room Group, LIFT CABIN = Subcontractor) */
  colAxisLabel: string;
  blockTotal: Stats;
};

export type MatrixShape = {
  plot: PlotKey;
  planGroups: string[];
  teams: TeamKey[];
  blocks: MatrixBlock[];
  plotTotal: Stats;
  /** 블록 배치와 무관하게 원본 room_group 기준으로 집계한 열 합계 (Room Group별 현황 카드용) */
  roomGroupTotals: Record<string, Stats>;
  /** 정규화 열 → 원본 room_group 값 목록 (드릴다운 필터용) */
  roomGroupSourceMap: Record<string, string[]>;
};

function emptyRoomGroupStats(): Record<string, Stats> {
  const out = {} as Record<string, Stats>;
  for (const rg of ALL_ROOM_GROUPS) out[rg] = newStats();
  return out;
}

function cellFor(cells: Record<string, Stats>, key: string): Stats {
  if (!cells[key]) cells[key] = newStats();
  return cells[key];
}

export function buildMatrix(
  plot: PlotKey,
  teams: TeamKey[],
  rawRows: MatrixRawRow[],
): MatrixShape {
  // 임시 구조: kind → buildingLabel → levelDisp → RoomGroupCol → Stats
  type RowsMap = Map<string, Map<string, { levelKind: LevelKind; sortIdx: number; cells: Record<string, Stats> }>>;
  const tower: RowsMap = new Map();
  const podium: RowsMap = new Map();
  const lg: RowsMap = new Map();
  const basement: RowsMap = new Map();
  const liftcabin: RowsMap = new Map();

  const ensure = (
    m: RowsMap,
    building: string,
    levelDisp: string,
    levelKind: LevelKind,
    sortIdx: number,
    dynamicCells = false,
  ) => {
    if (!m.has(building)) m.set(building, new Map());
    const b = m.get(building)!;
    if (!b.has(levelDisp))
      b.set(levelDisp, { levelKind, sortIdx, cells: dynamicCells ? {} : emptyRoomGroupStats() });
    return b.get(levelDisp)!;
  };

  for (const r of rawRows) {
    const lvl = parseLevel(r.level_name);
    const bld = classifyBuilding(r.building);
    const rg = normalizeRoomGroup(r.room_group);

    // Room Group 카드 집계는 블록 배치(LIFT CABIN 등)와 무관하게 항상 누적한다.
    addRow(cellFor(roomGroupTotals, rg), r);
    const srcVal = (r.room_group ?? "").trim() || "__EMPTY__";
    (roomGroupSourceMap[rg] ??= new Set<string>()).add(srcVal);

    let block: RowsMap;
    let buildingLabel: string;
    let levelDisp: string;
    // LIFT CABIN / LG 는 building 단독 판정 — level_name 판정보다 우선한다.
    if (bld.kind === "liftcabin") {
      const roomKey = (r.room ?? "").trim() || "N/A";
      const subKey = (r.subcontractor ?? "").trim() || "N/A";
      const e = ensure(liftcabin, "LIFT CABIN", roomKey, "unknown", 0, true);
      addRow(cellFor(e.cells, subKey), r);
      continue;
    } else if (bld.kind === "lg") {
      block = lg;
      buildingLabel = "LG";
      levelDisp = "LG";
    } else if (lvl.kind === "basement") {
      block = basement;
      buildingLabel = "Basement"; // 공통
      levelDisp = `Level ${lvl.key}`;
    } else if (bld.kind === "tower") {
      block = tower;
      buildingLabel = "Tower";
      levelDisp = lvl.kind === "ground" ? `Level ${lvl.key}` : "Level ?";
    } else if (bld.kind === "podium") {
      block = podium;
      buildingLabel = bld.label;
      levelDisp = lvl.kind === "ground" ? `Level ${lvl.key}` : "Level ?";
    } else {
      // Others → 지상 판정 시 Podium 옆에 별도 building 라벨로
      block = podium;
      buildingLabel = "Others";
      levelDisp = lvl.kind === "ground" ? `Level ${lvl.key}` : "Level ?";
    }

    const entry = ensure(block, buildingLabel, levelDisp, lvl.kind, lvl.sortIdx);
    addRow(entry.cells[rg], r);
  }

  const buildBlock = (kind: BlockKey, title: string, source: RowsMap): MatrixBlock => {
    const rows: MatrixRow[] = [];
    // 정렬 순서 building
    const buildingOrder = (() => {
      if (kind === "tower") return ["Tower"];
      if (kind === "basement") return ["Basement"];
      if (kind === "lg") return ["LG"];
      // podium
      const known = PODIUM_ORDER.filter((b) => source.has(b));
      const others = Array.from(source.keys()).filter((b) => !PODIUM_ORDER.includes(b)).sort();
      return [...known, ...others];
    })();

    for (const bLabel of buildingOrder) {
      const bMap = source.get(bLabel);
      if (!bMap) continue;
      const levels = Array.from(bMap.entries());
      // 정렬
      levels.sort(([ka2, a], [kb2, b]) => {
        if (kind === "liftcabin") return compareRoomNatural(ka2, kb2);
        if (kind === "basement") {
          // LG → B1 → B4
          const ka = a.sortIdx;
          const kb = b.sortIdx;
          return ka - kb;
        }
        // 지상: 큰 숫자가 위
        return b.sortIdx - a.sortIdx;
      });
      for (const [levelDisp, info] of levels) {
        const rowTotal = newStats();
        for (const rg of Object.keys(info.cells)) mergeStats(rowTotal, info.cells[rg]);
        rows.push({
          building: bLabel,
          levelDisp,
          levelKind: info.levelKind,
          cells: info.cells,
          rowTotal,
        });
      }
    }

    const colTotals: Record<string, Stats> = kind === "liftcabin" ? {} : emptyRoomGroupStats();
    const blockTotal = newStats();
    for (const row of rows) {
      for (const rg of Object.keys(row.cells)) mergeStats(cellFor(colTotals, rg), row.cells[rg]);
      mergeStats(blockTotal, row.rowTotal);
    }

    const columnKeys: string[] =
      kind === "lg"
        ? (() => {
            const present = LG_ROOM_GROUPS.filter((rg) => colTotals[rg].issued > 0);
            return (present.length ? present : LG_ROOM_GROUPS.slice(0, 1)) as string[];
          })()
        : kind === "liftcabin"
          ? (() => {
              const keys = Object.keys(colTotals).filter((k) => colTotals[k].issued > 0);
              const named = keys.filter((k) => k !== "N/A").sort((a, b) => a.localeCompare(b));
              const hasNa = keys.includes("N/A");
              return hasNa ? [...named, "N/A"] : named;
            })()
          : (() => {
              const present = ROOM_GROUP_ORDER.filter((rg) => (colTotals[rg]?.issued ?? 0) > 0);
              return (present.length ? present : ROOM_GROUP_ORDER.slice(0, 1)) as string[];
            })();

    // 동적 열 블록: 모든 행에 열 키를 채워 렌더 시 undefined 접근을 막는다
    if (kind === "liftcabin") {
      for (const row of rows) for (const k of columnKeys) cellFor(row.cells, k);
      for (const k of columnKeys) cellFor(colTotals, k);
    }

    const rowAxis =
      kind === "liftcabin"
        ? { primary: "Block", secondary: "Room" }
        : { primary: "Building", secondary: "Level" };
    const colAxisLabel = kind === "liftcabin" ? "Subcontractor" : "Room Group";

    return { kind, title, rows, columnKeys, colTotals, rowAxis, colAxisLabel, blockTotal };
  };

  const blocks: MatrixBlock[] = [];
  if (tower.size) blocks.push(buildBlock("tower", "Tower", tower));
  if (podium.size) blocks.push(buildBlock("podium", "Podium", podium));
  if (lg.size) blocks.push(buildBlock("lg", "LG (Lower Ground)", lg));
  if (basement.size) blocks.push(buildBlock("basement", "Basement (지하)", basement));
  if (liftcabin.size) blocks.push(buildBlock("liftcabin", "LIFT CABIN", liftcabin));

  const plotTotal = newStats();
  for (const b of blocks) mergeStats(plotTotal, b.blockTotal);

  return { plot, planGroups: planGroupsForPlot(plot), teams, blocks, plotTotal };
}

// ── 드릴다운 URL 파라미터 조립 ────────────────────────────────────

export type MetricKey = "issued" | "open" | "rectified" | "reopen" | "closed" | "closurePct";

export function metricSearchParams(m: MetricKey): Record<string, string> {
  switch (m) {
    case "issued":
      return {};
    case "open":
      return { status: "Open" };
    case "rectified":
      return { status: "Rectified" };
    case "reopen":
      return { status: "Re-Opened" };
    case "closed":
      return { status: "Closed" };
    case "closurePct":
      return { status: "Closed" };
  }
}

// building 그룹 헤더 → members (콤마 결합해 raw-data 필터로 전달)
export function buildingGroupMembers(kind: BlockKey, presentBuildings: string[]): string[] {
  if (kind === "tower") return ["Tower", "Tower 4"];
  if (kind === "basement") return []; // basement는 building 무관, level=B*로만 필터
  if (kind === "lg") return ["LG"];
  // podium
  return presentBuildings; // 이미 정규화된 라벨 (예: Podium, Podium 1..4, Others)
}

export function basementLevelParam(): string {
  // level_name 값은 "Level B1" 형태이므로 이대로 콤마 결합
  return ["Level LG", "Level B1", "Level B2", "Level B3", "Level B4"].join(",");
}
