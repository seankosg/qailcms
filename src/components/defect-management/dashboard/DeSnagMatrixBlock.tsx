import { cn } from "@/lib/utils";
import {
  ROOM_GROUP_ORDER,
  type MatrixBlock,
  type RoomGroupCol,
  type Stats,
  metricSearchParams,
  basementLevelParam,
} from "@/lib/defect-management/dashboard-shape";

type MetricSlot = "issued" | "open" | "rectified" | "reopen" | "closed" | "closurePct";

// ── Metric column configuration ────────────────────────────────────────────
const METRIC_COLS: Array<{ slot: MetricSlot; label: string; short: string }> = [
  { slot: "issued", label: "Issued", short: "ISS" },
  { slot: "open", label: "Open", short: "OPN" },
  { slot: "rectified", label: "Rect", short: "RCT" },
  { slot: "reopen", label: "Re-Op", short: "RO" },
  { slot: "closed", label: "Closed", short: "CLS" },
  { slot: "closurePct", label: "Cls%", short: "%" },
];

function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "–";
  return `${Math.round(pct * 100)}%`;
}

function closurePctTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  const p = pct * 100;
  if (p < 40) return "text-destructive font-semibold";
  if (p < 80) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

function closurePctBg(pct: number | null): string {
  if (pct == null) return "";
  const p = pct * 100;
  if (p < 40) return "bg-destructive/10";
  if (p < 80) return "bg-amber-500/10";
  return "bg-emerald-500/10";
}

/** Render 6 metric <td> cells for a single Stats block. */
function MetricCells({
  stats,
  onMetric,
  dim,
  groupIndex,
  isTotal,
}: {
  stats: Stats;
  onMetric: (m: MetricSlot) => void;
  dim?: boolean;
  groupIndex: number;
  isTotal?: boolean;
}) {
  const groupBg = isTotal
    ? "bg-primary/5"
    : groupIndex % 2 === 0
      ? "bg-transparent"
      : "bg-muted/20";
  return (
    <>
      {METRIC_COLS.map((mc, i) => {
        const isFirst = i === 0;
        const value =
          mc.slot === "issued"
            ? stats.issued
            : mc.slot === "open"
              ? stats.open
              : mc.slot === "rectified"
                ? stats.rectified
                : mc.slot === "reopen"
                  ? stats.reopen
                  : mc.slot === "closed"
                    ? stats.closed
                    : null; // closurePct handled below
        const isPct = mc.slot === "closurePct";
        const pctTone = isPct ? closurePctTone(stats.closurePct) : "";
        const pctBg = isPct ? closurePctBg(stats.closurePct) : "";
        const zeroDim = !isPct && (value ?? 0) === 0 ? "text-muted-foreground/50" : "text-foreground";
        const pctText = isPct ? fmtPct(stats.closurePct) : value!.toLocaleString();
        const ratio =
          !isPct && mc.slot !== "issued" && stats.issued > 0 && (value ?? 0) > 0
            ? ` (${Math.round(((value ?? 0) / stats.issued) * 100)}%)`
            : "";
        return (
          <td
            key={mc.slot}
            className={cn(
              "h-7 border-b p-0 tabular-nums",
              groupBg,
              isFirst && "border-l-2 border-l-border",
              !isFirst && "border-r border-r-border/40",
              pctBg,
              dim && "opacity-50",
            )}
          >
            <button
              type="button"
              onClick={() => onMetric(mc.slot)}
              title={`${mc.label}: ${pctText}${ratio}`}
              className={cn(
                "block h-full w-full px-1.5 text-right text-xs leading-none hover:bg-primary/10",
                mc.slot === "issued" && "font-medium",
                pctTone,
                !isPct && zeroDim,
              )}
            >
              {pctText}
            </button>
          </td>
        );
      })}
    </>
  );
}

/** Two-row header: group names spanning 6 metric subcolumns each. */
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
  return (
    <thead>
      {/* Row 1: sticky labels + group names */}
      <tr className="bg-muted/50">
        <th
          rowSpan={2}
          className="sticky left-0 z-20 min-w-[100px] border-b-2 border-r bg-muted/70 px-2 py-1.5 text-left text-[11px] font-semibold"
        >
          Building
        </th>
        <th
          rowSpan={2}
          className="sticky left-[100px] z-20 min-w-[80px] border-b-2 border-r bg-muted/70 px-2 py-1.5 text-left text-[11px] font-semibold"
        >
          Level
        </th>
        {groups.map((g, idx) => (
          <th
            key={g.key}
            colSpan={6}
            className={cn(
              "border-b border-l-2 border-l-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide",
              g.isTotal && "bg-primary/10",
              g.isNa && "bg-muted/50 text-muted-foreground",
              !g.isTotal && !g.isNa && idx % 2 === 1 && "bg-muted/30",
            )}
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
      {/* Row 2: metric subheaders repeating per group */}
      <tr className="bg-muted/30">
        {groups.map((g, idx) => (
          <SubHeaderCells
            key={g.key}
            groupIndex={idx}
            isTotal={g.isTotal}
            isNa={g.isNa}
          />
        ))}
      </tr>
    </thead>
  );
}

function SubHeaderCells({
  groupIndex,
  isTotal,
  isNa,
}: {
  groupIndex: number;
  isTotal?: boolean;
  isNa?: boolean;
}) {
  const groupBg = isTotal
    ? "bg-primary/10"
    : isNa
      ? "bg-muted/40"
      : groupIndex % 2 === 1
        ? "bg-muted/30"
        : "bg-muted/10";
  return (
    <>
      {METRIC_COLS.map((mc, i) => (
        <th
          key={mc.slot}
          className={cn(
            "h-7 border-b px-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
            groupBg,
            i === 0 && "border-l-2 border-l-border",
            i !== 0 && "border-r border-r-border/40",
            mc.slot === "issued" && "min-w-[46px]",
            mc.slot !== "issued" && "min-w-[40px]",
          )}
          title={mc.label}
        >
          {mc.label}
        </th>
      ))}
    </>
  );
}

export function DeSnagMatrixBlock({
  block,
  onNavigate,
  presentBuildings,
}: {
  block: MatrixBlock;
  presentBuildings: string[];
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
    slot: MetricSlot,
  ) => {
    const p: Record<string, string> = { ...basementParam };
    if (rowBuilding && block.kind !== "basement") p.building = rowBuilding;
    else if (block.kind !== "basement") Object.assign(p, buildingParam);
    if (rowLevelDisp) p.level = rowLevelDisp;
    if (col === "FACADE") p.roomGroup = "FACADE,LANDSCAPE";
    else if (col === "N/A") p.roomGroup = "__EMPTY__";
    else if (col !== "__ROW_TOTAL__" && col !== "__BUILDING_SUBTOTAL__") p.roomGroup = col;
    Object.assign(p, metricSearchParams(slot));
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
        cur = { building: r.building, rows: [], subtotal: { open: 0, rectified: 0, reopen: 0, closed: 0, issued: 0, closurePct: null } };
      }
      cur.rows.push(r);
      cur.subtotal.open += r.rowTotal.open;
      cur.subtotal.rectified += r.rowTotal.rectified;
      cur.subtotal.reopen += r.rowTotal.reopen;
      cur.subtotal.closed += r.rowTotal.closed;
      cur.subtotal.issued += r.rowTotal.issued;
      cur.subtotal.closurePct = cur.subtotal.issued > 0 ? cur.subtotal.closed / cur.subtotal.issued : null;
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <MatrixHeader
            block={block}
            buildingParam={buildingParam}
            basementParam={basementParam}
            onNavigate={onNavigate}
          />
          <tbody>
            {groups.map((grp) => (
              <FragmentRows
                key={grp.building}
                group={grp}
                block={block}
                buildingParam={buildingParam}
                basementParam={basementParam}
                onNavigate={onNavigate}
                goCell={goCell}
              />
            ))}

            {/* Column Total 행 */}
            <tr className="bg-primary/5 font-medium">
              <td className="sticky left-0 z-10 border-r border-t-2 border-t-border bg-primary/10 px-2 py-1 text-[11px]" colSpan={2}>
                <button
                  type="button"
                  onClick={() => onNavigate({ ...buildingParam, ...basementParam })}
                  className="hover:text-primary"
                >
                  Column Total
                </button>
              </td>
              {ROOM_GROUP_ORDER.map((rg, idx) => (
                <MetricCells
                  key={rg}
                  stats={block.colTotals[rg]}
                  onMetric={(m) => goCell(null, null, rg, m)}
                  groupIndex={idx}
                />
              ))}
              <MetricCells
                stats={block.blockTotal}
                onMetric={(m) => goCell(null, null, "__ROW_TOTAL__", m)}
                groupIndex={ROOM_GROUP_ORDER.length}
                isTotal
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({
  group,
  block,
  buildingParam,
  basementParam,
  onNavigate,
  goCell,
}: {
  group: { building: string; rows: MatrixBlock["rows"]; subtotal: Stats };
  block: MatrixBlock;
  buildingParam: Record<string, string>;
  basementParam: Record<string, string>;
  onNavigate: (p: Record<string, string>) => void;
  goCell: (b: string | null, l: string | null, c: RoomGroupCol | "__ROW_TOTAL__" | "__BUILDING_SUBTOTAL__", m: MetricSlot) => void;
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
            <MetricCells
              key={rg}
              stats={r.cells[rg]}
              onMetric={(m) => goCell(r.building, r.levelDisp, rg, m)}
              dim={r.cells[rg].issued === 0}
              groupIndex={gIdx}
            />
          ))}
          <MetricCells
            stats={r.rowTotal}
            onMetric={(m) => goCell(r.building, r.levelDisp, "__ROW_TOTAL__", m)}
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
            const sub: Stats = { open: 0, rectified: 0, reopen: 0, closed: 0, issued: 0, closurePct: null };
            for (const r of group.rows) {
              sub.open += r.cells[rg].open;
              sub.rectified += r.cells[rg].rectified;
              sub.reopen += r.cells[rg].reopen;
              sub.closed += r.cells[rg].closed;
              sub.issued += r.cells[rg].issued;
            }
            sub.closurePct = sub.issued > 0 ? sub.closed / sub.issued : null;
            return (
              <MetricCells
                key={rg}
                stats={sub}
                onMetric={(m) => goCell(group.building, null, rg, m)}
                groupIndex={gIdx}
              />
            );
          })}
          <MetricCells
            stats={group.subtotal}
            onMetric={(m) => goCell(group.building, null, "__BUILDING_SUBTOTAL__", m)}
            groupIndex={ROOM_GROUP_ORDER.length}
            isTotal
          />
        </tr>
      )}
    </>
  );
}
