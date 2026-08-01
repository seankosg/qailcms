import { cn } from "@/lib/utils";
import {
  ROOM_GROUP_ORDER,
  TEAM_COL_ORDER,
  bottleneckTeam,
  newStats,
  mergeStats,
  type MatrixBlock,
  type RoomGroupCol,
  type Stats,
  type TeamKey,
  basementLevelParam,
} from "@/lib/defect-management/dashboard-shape";

export type MatrixMode = "count" | "pct";

type StatusSlot = "issued" | "rect" | "closed";

const STATUS_COLS: Array<{ slot: StatusSlot; label: string }> = [
  { slot: "issued", label: "Issued" },
  { slot: "rect", label: "Rect" },
  { slot: "closed", label: "Closed" },
];

const COLS_PER_GROUP = STATUS_COLS.length * TEAM_COL_ORDER.length; // 9

function pctTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct < 40) return "text-destructive font-semibold";
  if (pct < 80) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

/** Render 9 team-decomposed <td> cells (Issued/Rect/Closed × Elec/Mech/Arch). */
function TeamCells({
  stats,
  mode,
  onCell,
  dim,
  groupIndex,
  isTotal,
  stickyTop,
}: {
  stats: Stats;
  mode: MatrixMode;
  onCell: (slot: StatusSlot, team: TeamKey) => void;
  dim?: boolean;
  groupIndex: number;
  isTotal?: boolean;
  stickyTop?: number;
}) {
  const groupBg = isTotal ? "bg-primary/5" : groupIndex % 2 === 0 ? "bg-transparent" : "bg-muted/20";
  const stickyBg = isTotal
    ? "color-mix(in oklab, var(--primary) 12%, var(--card))"
    : groupIndex % 2 === 0
      ? "var(--card)"
      : "color-mix(in oklab, var(--muted) 25%, var(--card))";

  const rectBottleneck = bottleneckTeam(stats.byTeam, "rect");
  const closedBottleneck = bottleneckTeam(stats.byTeam, "closed");

  return (
    <>
      {STATUS_COLS.map((sc, sIdx) =>
        TEAM_COL_ORDER.map((team, tIdx) => {
          const t = stats.byTeam[team];
          const count = sc.slot === "issued" ? t.issued : sc.slot === "rect" ? t.rect : t.closed;
          const ratio = t.issued > 0 && sc.slot !== "issued" ? (count / t.issued) * 100 : null;
          const showPct = mode === "pct" && sc.slot !== "issued";
          const text = showPct
            ? ratio == null
              ? "–"
              : `${Math.round(ratio)}%`
            : count.toLocaleString();
          const isBottleneck =
            (sc.slot === "rect" && rectBottleneck === team) ||
            (sc.slot === "closed" && closedBottleneck === team);
          const isFirstOfGroup = sIdx === 0 && tIdx === 0;
          const isFirstOfStatus = tIdx === 0;
          const zeroDim = !showPct && count === 0 ? "text-muted-foreground/50" : "text-foreground";
          return (
            <td
              key={`${sc.slot}-${team}`}
              className={cn(
                "h-7 border-b p-0 tabular-nums",
                stickyTop === undefined && groupBg,
                stickyTop !== undefined && "sticky z-20",
                isFirstOfGroup && "border-l-2 border-l-border",
                !isFirstOfGroup && isFirstOfStatus && "border-l border-l-border/70",
                !isFirstOfStatus && "border-r border-r-border/30",
                isBottleneck && "bg-destructive/15",
                dim && "opacity-50",
              )}
              style={stickyTop !== undefined ? { top: stickyTop, background: isBottleneck ? undefined : stickyBg } : undefined}
            >
              <button
                type="button"
                onClick={() => onCell(sc.slot, team)}
                title={`${team} ${sc.label}: ${count.toLocaleString()}${
                  ratio != null ? ` (${Math.round(ratio)}%)` : ""
                }${isBottleneck ? " · 병목" : ""}`}
                className={cn(
                  "block h-full w-full px-1 text-right text-xs leading-none hover:bg-primary/10",
                  sc.slot === "issued" && "font-medium",
                  showPct ? pctTone(ratio) : zeroDim,
                  isBottleneck && "font-semibold",
                )}
              >
                {text}
              </button>
            </td>
          );
        }),
      )}
    </>
  );
}

/** Three-row header: Room Group → Status → Team. */
function MatrixHeader({
  block,
  buildingParam,
  basementParam,
  onNavigate,
}: {
  block: MatrixBlock;
  buildingParam: Record<string, string>;
  basementParam: Record<string, string>;
  onNavigate: (p: Record<string, string>) => void;
}) {
  const groups: Array<{ key: string; label: string; isTotal?: boolean; isNa?: boolean }> = [
    ...ROOM_GROUP_ORDER.map((rg) => ({ key: rg, label: rg, isNa: rg === "N/A" })),
    { key: "__ROW_TOTAL__", label: "Row Total", isTotal: true },
  ];
  const groupBg = (g: { isTotal?: boolean; isNa?: boolean }, idx: number) =>
    g.isTotal
      ? "color-mix(in oklab, var(--primary) 10%, var(--card))"
      : g.isNa
        ? "color-mix(in oklab, var(--muted) 50%, var(--card))"
        : idx % 2 === 1
          ? "color-mix(in oklab, var(--muted) 30%, var(--card))"
          : "color-mix(in oklab, var(--muted) 50%, var(--card))";
  return (
    <thead>
      {/* Tier 1: Room Group */}
      <tr className="bg-muted/50">
        <th
          rowSpan={3}
          className="sticky left-0 top-0 z-40 min-w-[100px] border-b-2 border-r px-2 py-1.5 text-left text-[11px] font-semibold"
          style={{ background: "color-mix(in oklab, var(--muted) 70%, var(--card))" }}
        >
          Building
        </th>
        <th
          rowSpan={3}
          className="sticky left-[100px] top-0 z-40 min-w-[80px] border-b-2 border-r px-2 py-1.5 text-left text-[11px] font-semibold"
          style={{ background: "color-mix(in oklab, var(--muted) 70%, var(--card))" }}
        >
          Level
        </th>
        {groups.map((g, idx) => (
          <th
            key={g.key}
            colSpan={COLS_PER_GROUP}
            className="sticky top-0 z-30 border-b border-l-2 border-l-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide"
            style={{ background: groupBg(g, idx) }}
          >
            {g.isTotal ? (
              <span>{g.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const p: Record<string, string> = { ...basementParam };
                  if (block.kind !== "basement") Object.assign(p, buildingParam);
                  p.roomGroup = g.key === "FACADE" ? "FACADE,LANDSCAPE" : g.key === "N/A" ? "__EMPTY__" : g.key;
                  onNavigate(p);
                }}
                className="hover:text-primary"
              >
                {g.label}
              </button>
            )}
          </th>
        ))}
      </tr>
      {/* Tier 2: Status */}
      <tr>
        {groups.map((g, idx) =>
          STATUS_COLS.map((sc, sIdx) => (
            <th
              key={`${g.key}-${sc.slot}`}
              colSpan={TEAM_COL_ORDER.length}
              className={cn(
                "sticky top-[30px] z-30 h-6 border-b px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                sIdx === 0 && "border-l-2 border-l-border",
                sIdx !== 0 && "border-l border-l-border/70",
              )}
              style={{ background: groupBg(g, idx) }}
            >
              {sc.label}
            </th>
          )),
        )}
      </tr>
      {/* Tier 3: Team */}
      <tr>
        {groups.map((g, idx) =>
          STATUS_COLS.map((sc, sIdx) =>
            TEAM_COL_ORDER.map((team, tIdx) => (
              <th
                key={`${g.key}-${sc.slot}-${team}`}
                className={cn(
                  "sticky top-[54px] z-30 h-6 min-w-[40px] border-b px-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
                  sIdx === 0 && tIdx === 0 && "border-l-2 border-l-border",
                  !(sIdx === 0 && tIdx === 0) && tIdx === 0 && "border-l border-l-border/70",
                  tIdx !== 0 && "border-r border-r-border/30",
                )}
                style={{ background: groupBg(g, idx) }}
                title={`${sc.label} · ${team}`}
              >
                {team === "ELEC" ? "Elec" : team === "MECH" ? "Mech" : "Arch"}
              </th>
            )),
          ),
        )}
      </tr>
    </thead>
  );
}

export function DeSnagMatrixBlock({
  block,
  onNavigate,
  presentBuildings,
  mode,
}: {
  block: MatrixBlock;
  presentBuildings: string[];
  mode: MatrixMode;
  onNavigate: (params: Record<string, string>) => void;
}) {
  const buildingMembers = (() => {
    if (block.kind === "tower") return ["Tower", "Tower 4"];
    if (block.kind === "basement") return [] as string[];
    return presentBuildings;
  })();

  const buildingParam: Record<string, string> = buildingMembers.length
    ? { building: buildingMembers.join(",") }
    : {};
  const basementParam: Record<string, string> =
    block.kind === "basement" ? { level: basementLevelParam() } : {};

  const goCell = (
    rowBuilding: string | null,
    rowLevelDisp: string | null,
    col: RoomGroupCol | "__ROW_TOTAL__" | "__BUILDING_SUBTOTAL__",
    slot: StatusSlot,
    team: TeamKey,
  ) => {
    const p: Record<string, string> = { ...basementParam };
    if (rowBuilding && block.kind !== "basement") p.building = rowBuilding;
    else if (block.kind !== "basement") Object.assign(p, buildingParam);
    if (rowLevelDisp) p.level = rowLevelDisp;
    if (col === "FACADE") p.roomGroup = "FACADE,LANDSCAPE";
    else if (col === "N/A") p.roomGroup = "__EMPTY__";
    else if (col !== "__ROW_TOTAL__" && col !== "__BUILDING_SUBTOTAL__") p.roomGroup = col;
    p.team = team;
    // 정본(_snag_done_asof) 동치: 자기 실적일 ≤ as-of. dateEnd 는 상위에서 as-of 로 채움.
    if (slot === "rect") p.dateField = "actual_rectified_date";
    else if (slot === "closed") p.dateField = "actual_closure_date";
    onNavigate(p);
  };

  // Building 별 소계 계산 (podium 블록에서만 의미 있음)
  type BuildingGroup = { building: string; rows: typeof block.rows; subtotal: Stats };
  const groups: BuildingGroup[] = [];
  {
    let cur: BuildingGroup | null = null;
    for (const r of block.rows) {
      if (!cur || cur.building !== r.building) {
        if (cur) groups.push(cur);
        cur = { building: r.building, rows: [], subtotal: newStats() };
      }
      cur.rows.push(r);
      mergeStats(cur.subtotal, r.rowTotal);
    }
    if (cur) groups.push(cur);
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <h3 className="text-sm font-semibold">{block.title}</h3>
        <button
          type="button"
          onClick={() => onNavigate({ ...buildingParam, ...basementParam })}
          className="text-[11px] text-muted-foreground hover:text-primary"
        >
          블록 전체 보기 →
        </button>
      </div>
      <div className="relative max-h-[calc(100dvh-260px)] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <MatrixHeader
            block={block}
            buildingParam={buildingParam}
            basementParam={basementParam}
            onNavigate={onNavigate}
          />
          <tbody>
            {/* Column Total 행 — 헤더 바로 아래 고정 */}
            <tr className="font-medium">
              <td
                className="sticky left-0 top-[78px] z-30 border-r border-b-2 border-b-border px-2 py-1 text-[11px]"
                colSpan={2}
                style={{ background: "color-mix(in oklab, var(--primary) 14%, var(--card))" }}
              >
                <button
                  type="button"
                  onClick={() => onNavigate({ ...buildingParam, ...basementParam })}
                  className="hover:text-primary"
                >
                  Column Total
                </button>
              </td>
              {ROOM_GROUP_ORDER.map((rg, idx) => (
                <TeamCells
                  key={rg}
                  stats={block.colTotals[rg]}
                  mode={mode}
                  onCell={(slot, team) => goCell(null, null, rg, slot, team)}
                  groupIndex={idx}
                  stickyTop={78}
                />
              ))}
              <TeamCells
                stats={block.blockTotal}
                mode={mode}
                onCell={(slot, team) => goCell(null, null, "__ROW_TOTAL__", slot, team)}
                groupIndex={ROOM_GROUP_ORDER.length}
                isTotal
                stickyTop={78}
              />
            </tr>
            {groups.map((grp) => (
              <FragmentRows
                key={grp.building}
                group={grp}
                block={block}
                basementParam={basementParam}
                mode={mode}
                onNavigate={onNavigate}
                goCell={goCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({
  group,
  block,
  basementParam,
  mode,
  onNavigate,
  goCell,
}: {
  group: { building: string; rows: MatrixBlock["rows"]; subtotal: Stats };
  block: MatrixBlock;
  basementParam: Record<string, string>;
  mode: MatrixMode;
  onNavigate: (p: Record<string, string>) => void;
  goCell: (
    b: string | null,
    l: string | null,
    c: RoomGroupCol | "__ROW_TOTAL__" | "__BUILDING_SUBTOTAL__",
    slot: StatusSlot,
    team: TeamKey,
  ) => void;
}) {
  const showBuildingSubtotal = block.kind === "podium" && group.rows.length > 1;
  return (
    <>
      {group.rows.map((r, idx) => (
        <tr key={`${r.building}::${r.levelDisp}`} className="hover:bg-muted/20">
          {idx === 0 && (
            <td
              rowSpan={group.rows.length + (showBuildingSubtotal ? 1 : 0)}
              className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1 align-top text-[11px] font-medium"
              style={{ background: "var(--card)" }}
            >
              <button
                type="button"
                onClick={() => {
                  const p: Record<string, string> =
                    block.kind === "basement" ? { ...basementParam } : { building: r.building };
                  onNavigate(p);
                }}
                className="hover:text-primary"
              >
                {r.building}
              </button>
            </td>
          )}
          <td
            className="sticky left-[100px] z-10 border-b border-r bg-card px-2 py-1 text-[11px]"
            style={{ background: "var(--card)" }}
          >
            <button
              type="button"
              onClick={() => {
                const p: Record<string, string> =
                  block.kind === "basement" ? { ...basementParam } : { building: r.building };
                p.level = r.levelDisp;
                onNavigate(p);
              }}
              className="hover:text-primary"
            >
              {r.levelDisp}
            </button>
          </td>
          {ROOM_GROUP_ORDER.map((rg, gIdx) => (
            <TeamCells
              key={rg}
              stats={r.cells[rg]}
              mode={mode}
              onCell={(slot, team) => goCell(r.building, r.levelDisp, rg, slot, team)}
              dim={r.cells[rg].issued === 0}
              groupIndex={gIdx}
            />
          ))}
          <TeamCells
            stats={r.rowTotal}
            mode={mode}
            onCell={(slot, team) => goCell(r.building, r.levelDisp, "__ROW_TOTAL__", slot, team)}
            groupIndex={ROOM_GROUP_ORDER.length}
            isTotal
          />
        </tr>
      ))}
      {showBuildingSubtotal && (
        <tr className="bg-muted/30 font-medium">
          <td
            className="sticky left-[100px] z-10 border-b border-r bg-muted/40 px-2 py-1 text-[11px]"
            style={{ background: "color-mix(in oklab, var(--muted) 60%, var(--card))" }}
          >
            {group.building} 소계
          </td>
          {ROOM_GROUP_ORDER.map((rg, gIdx) => {
            const sub = newStats();
            for (const r of group.rows) mergeStats(sub, r.cells[rg]);
            return (
              <TeamCells
                key={rg}
                stats={sub}
                mode={mode}
                onCell={(slot, team) => goCell(group.building, null, rg, slot, team)}
                groupIndex={gIdx}
              />
            );
          })}
          <TeamCells
            stats={group.subtotal}
            mode={mode}
            onCell={(slot, team) => goCell(group.building, null, "__BUILDING_SUBTOTAL__", slot, team)}
            groupIndex={ROOM_GROUP_ORDER.length}
            isTotal
          />
        </tr>
      )}
    </>
  );
}
