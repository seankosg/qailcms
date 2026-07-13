import { cn } from "@/lib/utils";
import { DeSnagStatusCell } from "./DeSnagStatusCell";
import {
  ROOM_GROUP_ORDER,
  type MatrixBlock,
  type RoomGroupCol,
  type Stats,
  metricSearchParams,
  basementLevelParam,
} from "@/lib/defect-management/dashboard-shape";

type MetricSlot = "issued" | "open" | "rectified" | "reopen" | "closed" | "closurePct";

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

  const buildingParam = buildingMembers.length ? { building: buildingMembers.join(",") } : {};
  const basementParam = block.kind === "basement" ? { level: basementLevelParam() } : {};

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
          <thead>
            <tr className="bg-muted/30">
              <th className="sticky left-0 z-10 min-w-[110px] border-b border-r bg-muted/60 px-2 py-1.5 text-left text-[11px] font-semibold">
                Building
              </th>
              <th className="sticky left-[110px] z-10 min-w-[90px] border-b border-r bg-muted/60 px-2 py-1.5 text-left text-[11px] font-semibold">
                Level
              </th>
              {ROOM_GROUP_ORDER.map((rg) => (
                <th
                  key={rg}
                  className={cn(
                    "min-w-[180px] border-b border-r px-1 py-1.5 text-center text-[11px] font-semibold",
                    rg === "N/A" && "bg-muted/50 text-muted-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onNavigate({
                      ...basementParam,
                      ...(block.kind === "basement" ? {} : buildingParam),
                      roomGroup: rg === "FACADE" ? "FACADE,LANDSCAPE" : rg === "N/A" ? "__EMPTY__" : rg,
                    })}
                    className="hover:text-primary"
                  >
                    {rg}
                  </button>
                </th>
              ))}
              <th className="min-w-[180px] border-b border-r bg-primary/5 px-1 py-1.5 text-center text-[11px] font-semibold">
                Row Total
              </th>
            </tr>
          </thead>
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
              <td className="sticky left-0 z-10 border-r bg-primary/10 px-2 py-1 text-[11px]" colSpan={2}>
                <button
                  type="button"
                  onClick={() => onNavigate({ ...buildingParam, ...basementParam })}
                  className="hover:text-primary"
                >
                  Column Total
                </button>
              </td>
              {ROOM_GROUP_ORDER.map((rg) => (
                <td
                  key={rg}
                  className={cn(
                    "border-r px-0.5 py-0.5 align-top",
                    rg === "N/A" && "bg-muted/50",
                  )}
                >
                  <DeSnagStatusCell
                    stats={block.colTotals[rg]}
                    onMetric={(m) => goCell(null, null, rg, m)}
                  />
                </td>
              ))}
              <td className="border-r bg-primary/10 px-0.5 py-0.5 align-top">
                <DeSnagStatusCell
                  stats={block.blockTotal}
                  onMetric={(m) => goCell(null, null, "__ROW_TOTAL__", m)}
                />
              </td>
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
            >
              <button
                type="button"
                onClick={() => onNavigate(block.kind === "basement" ? basementParam : { building: r.building })}
                className="hover:text-primary"
              >
                {r.building}
              </button>
            </td>
          )}
          <td className="sticky left-[110px] z-10 border-b border-r bg-card px-2 py-1 text-[11px]">
            <button
              type="button"
              onClick={() => onNavigate({
                ...(block.kind === "basement" ? basementParam : { building: r.building }),
                level: r.levelDisp,
              })}
              className="hover:text-primary"
            >
              {r.levelDisp}
            </button>
          </td>
          {ROOM_GROUP_ORDER.map((rg) => (
            <td
              key={rg}
              className={cn(
                "border-b border-r px-0.5 py-0.5 align-top",
                rg === "N/A" && "bg-muted/40",
              )}
            >
              <DeSnagStatusCell
                stats={r.cells[rg]}
                onMetric={(m) => goCell(r.building, r.levelDisp, rg, m)}
                dim={r.cells[rg].issued === 0}
              />
            </td>
          ))}
          <td className="border-b border-r bg-primary/5 px-0.5 py-0.5 align-top">
            <DeSnagStatusCell
              stats={r.rowTotal}
              onMetric={(m) => goCell(r.building, r.levelDisp, "__ROW_TOTAL__", m)}
            />
          </td>
        </tr>
      ))}
      {showBuildingSubtotal && (
        <tr className="bg-muted/30 font-medium">
          <td className="sticky left-[110px] z-10 border-b border-r bg-muted/40 px-2 py-1 text-[11px]">
            {group.building} 소계
          </td>
          {ROOM_GROUP_ORDER.map((rg) => {
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
              <td key={rg} className={cn("border-b border-r px-0.5 py-0.5 align-top", rg === "N/A" && "bg-muted/50")}>
                <DeSnagStatusCell
                  stats={sub}
                  onMetric={(m) => goCell(group.building, null, rg, m)}
                />
              </td>
            );
          })}
          <td className="border-b border-r bg-primary/10 px-0.5 py-0.5 align-top">
            <DeSnagStatusCell
              stats={group.subtotal}
              onMetric={(m) => goCell(group.building, null, "__BUILDING_SUBTOTAL__", m)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
