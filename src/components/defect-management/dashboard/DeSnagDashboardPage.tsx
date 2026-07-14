import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Route as DashboardRoute } from "@/routes/_authenticated/closure/snag-management/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeSnagToolbar } from "./DeSnagToolbar";
import { DeSnagMatrixBlock } from "./DeSnagMatrixBlock";
import { DeSnagGrandTotalCards } from "./DeSnagGrandTotalCards";
import { useSnagDashboardMatrix } from "@/hooks/useSnagDashboardMatrix";
import {
  ALL_TEAMS,
  buildMatrix,
  planGroupsForPlot,
  type PlotKey,
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

  const { data: rawRows = [], isLoading, error } = useSnagDashboardMatrix(plot, teams);
  const matrix = useMemo(() => buildMatrix(plot, teams, rawRows), [plot, teams, rawRows]);

  const setPlot = (p: PlotKey) => navigate({ to: "/closure/snag-management/dashboard", search: { plot: p, teams: search.teams ?? "" } });
  const setTeams = (t: TeamKey[]) => navigate({
    to: "/closure/snag-management/dashboard",
    search: { plot, teams: t.join(",") },
  });

  const goRaw = (params: Record<string, string>) => {
    const planGroups = planGroupsForPlot(plot).join(",");
    const merged: Record<string, string> = {
      source: "dashboard",
      plan_group: planGroups,
      ...(teams.length ? { team: teams.join(",") } : {}),
      ...params,
    };
    navigate({ to: "/closure/snag-management/raw-data", search: merged as any });
  };

  const presentPodiumBuildings = useMemo(() => {
    const b = matrix.blocks.find((x) => x.kind === "podium");
    if (!b) return [] as string[];
    return Array.from(new Set(b.rows.map((r) => r.building)));
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
          else if (m === "closed" || m === "closurePct") p.status = "Closed";
          goRaw(p);
        }}
      />

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
