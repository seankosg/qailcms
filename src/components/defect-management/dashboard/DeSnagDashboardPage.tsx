import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Route as DashboardRoute } from "@/routes/_authenticated/closure/snag-management/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { DeSnagToolbar } from "./DeSnagToolbar";
import { DeSnagMatrixBlock } from "./DeSnagMatrixBlock";
import { DeSnagStatusCell } from "./DeSnagStatusCell";
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
  const teams = useMemo(
    () =>
      (search.teams ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is TeamKey => (ALL_TEAMS as readonly string[]).includes(s)),
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

      {/* Plot Grand Total 배너 */}
      <Card className="border-primary/40 bg-primary/[0.03] p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plot {plot} Grand Total
          </span>
          <button
            type="button"
            onClick={() => goRaw({})}
            className="text-[11px] text-muted-foreground hover:text-primary"
          >
            전체 목록 →
          </button>
        </div>
        <div className="max-w-md">
          <DeSnagStatusCell
            stats={matrix.plotTotal}
            onMetric={(m) => {
              const p =
                m === "issued"
                  ? {}
                  : m === "open"
                    ? { status: "Open" }
                    : m === "rectified"
                      ? { status: "Rectified" }
                      : m === "reopen"
                        ? { status: "Re-Opened" }
                        : { status: "Closed" };
              goRaw(p);
            }}
          />
        </div>
      </Card>

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
