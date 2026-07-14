import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Route as DashboardRoute } from "@/routes/_authenticated/closure/snag-management/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeSnagToolbar } from "./DeSnagToolbar";
import { DeSnagMatrixBlock } from "./DeSnagMatrixBlock";
import { DeSnagGrandTotalCards } from "./DeSnagGrandTotalCards";
import { DeSnagRoomGroupCards } from "./DeSnagRoomGroupCards";
import { DeSnagRoomGroupFilterBar } from "./DeSnagRoomGroupFilterBar";
import { useSnagDashboardMatrix } from "@/hooks/useSnagDashboardMatrix";
import {
  ALL_TEAMS,
  buildMatrix,
  mergeStats,
  newStats,
  normalizeRoomGroup,
  planGroupsForPlot,
  ROOM_GROUP_ORDER,
  type PlotKey,
  type RoomGroupCol,
  type Stats,
  type TeamKey,
} from "@/lib/defect-management/dashboard-shape";

export function DeSnagDashboardPage() {
  const search = DashboardRoute.useSearch();
  const navigate = useNavigate();
  const plot = (search.plot ?? "C") as PlotKey;
  const teams = useMemo<TeamKey[]>(
    () =>
      (search.teams ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string): s is TeamKey => (ALL_TEAMS as readonly string[]).includes(s)),
    [search.teams],
  );
  const roomGroups = useMemo<RoomGroupCol[]>(
    () =>
      (search.roomGroups ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string): s is RoomGroupCol =>
          (ROOM_GROUP_ORDER as readonly string[]).includes(s),
        ),
    [search.roomGroups],
  );

  const { data: rawRows = [], isLoading, error } = useSnagDashboardMatrix(plot, teams);
  const filteredRows = useMemo(() => {
    if (roomGroups.length === 0) return rawRows;
    const set = new Set<RoomGroupCol>(roomGroups);
    return rawRows.filter((r) => set.has(normalizeRoomGroup(r.room_group)));
  }, [rawRows, roomGroups]);
  const matrix = useMemo(
    () => buildMatrix(plot, teams, filteredRows),
    [plot, teams, filteredRows],
  );

  const teamsStr = search.teams ?? "";
  const rgStr = search.roomGroups ?? "";
  const setPlot = (p: PlotKey) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: { plot: p, teams: teamsStr, roomGroups: rgStr },
    });
  const setTeams = (t: TeamKey[]) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: { plot, teams: t.join(","), roomGroups: rgStr },
    });
  const setRoomGroups = (rgs: RoomGroupCol[]) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: { plot, teams: teamsStr, roomGroups: rgs.join(",") },
    });

  function roomGroupParam(col: RoomGroupCol): string {
    if (col === "FACADE") return "FACADE,LANDSCAPE";
    if (col === "N/A") return "__EMPTY__";
    return col;
  }

  const goRaw = (params: Record<string, string>) => {
    const planGroups = planGroupsForPlot(plot).join(",");
    // 필터 활성 시 roomGroup 파라미터 병합 (호출 측 지정이 우선)
    const rgParam =
      roomGroups.length > 0
        ? Array.from(
            new Set(
              roomGroups
                .flatMap((rg) => roomGroupParam(rg).split(","))
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ).join(",")
        : "";
    const merged: Record<string, string> = {
      source: "dashboard",
      plan_group: planGroups,
      ...(teams.length ? { team: teams.join(",") } : {}),
      ...(rgParam ? { roomGroup: rgParam } : {}),
      ...params,
    };
    navigate({ to: "/closure/snag-management/raw-data", search: merged as any });
  };

  const presentPodiumBuildings = useMemo(() => {
    const b = matrix.blocks.find((x) => x.kind === "podium");
    if (!b) return [] as string[];
    return Array.from(new Set(b.rows.map((r) => r.building)));
  }, [matrix]);

  const roomGroupEntries = useMemo(() => {
    const totals: Record<RoomGroupCol, Stats> = ROOM_GROUP_ORDER.reduce(
      (acc, rg) => {
        acc[rg] = newStats();
        return acc;
      },
      {} as Record<RoomGroupCol, Stats>,
    );
    for (const block of matrix.blocks) {
      for (const rg of ROOM_GROUP_ORDER) {
        mergeStats(totals[rg], block.colTotals[rg]);
      }
    }
    return ROOM_GROUP_ORDER.map((col) => ({ col, stats: totals[col] }));
  }, [matrix]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">De-Snagging Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Plot · Building · Level × Room Group 매트릭스. 셀·헤더 클릭 시 Raw Data 드릴다운.
          </p>
        </div>
        <DeSnagToolbar teams={teams} onChange={setTeams} />
      </div>

      <Tabs value={plot} onValueChange={(v) => setPlot(v as PlotKey)}>
        <TabsList>
          <TabsTrigger value="C">Plot C (+Tower 3)</TabsTrigger>
          <TabsTrigger value="D">Plot D (+Tower 4)</TabsTrigger>
        </TabsList>
      </Tabs>

      <DeSnagRoomGroupFilterBar selected={roomGroups} onChange={setRoomGroups} />

      {/* Plot Grand Total — KPI 카드 */}
      <DeSnagGrandTotalCards
        plot={plot}
        stats={matrix.plotTotal}
        onAll={() => goRaw({})}
        onMetric={(m) => {
          const p: Record<string, string> = {};
          if (m === "open") p.status = "Open";
          else if (m === "rectified") p.status = "Rectified";
          else if (m === "reopen") p.status = "Re-Opened";
          else if (m === "closed") p.status = "Closed";
          goRaw(p);
        }}
      />

      <DeSnagRoomGroupCards entries={roomGroupEntries} onNavigate={goRaw} />

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {error && <p className="text-sm text-destructive">오류: {(error as Error).message}</p>}
      {!isLoading && !error && matrix.blocks.length === 0 && (
        <p className="text-sm text-muted-foreground">해당 조건의 데이터가 없습니다.</p>
      )}

      <div className="flex flex-col gap-4">
        {matrix.blocks.map((block) => (
          <DeSnagMatrixBlock
            key={block.kind}
            block={block}
            presentBuildings={block.kind === "podium" ? presentPodiumBuildings : []}
            onNavigate={goRaw}
          />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        각 셀 = ISSUED · Open · Rectified · Re-Open · Closed · Closure%. 비율 = ISSUED 대비. Closure% =
        Closed ÷ ISSUED.
      </p>
    </div>
  );
}
