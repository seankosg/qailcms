import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Route as DashboardRoute } from "@/routes/_authenticated/closure/snag-management/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeSnagToolbar } from "./DeSnagToolbar";
import { DeSnagMatrixBlock } from "./DeSnagMatrixBlock";
import { DeSnagGrandTotalCards } from "./DeSnagGrandTotalCards";
import { DeSnagRoomGroupCards } from "./DeSnagRoomGroupCards";
import { DeSnagRoomGroupFilterBar } from "./DeSnagRoomGroupFilterBar";
import { useSnagDashboardMatrix } from "@/hooks/useSnagDashboardMatrix";
import { useDefectLatestDataDate } from "@/hooks/useDefectLatestDataDate";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
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

  // URL에 적용된 필터 (서버 RPC 및 데이터 표시용)
  const appliedPlot = (search.plot ?? "C") as PlotKey;
  const appliedTeams = useMemo<TeamKey[]>(
    () =>
      (search.teams ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string): s is TeamKey => (ALL_TEAMS as readonly string[]).includes(s)),
    [search.teams],
  );
  const appliedRoomGroups = useMemo<RoomGroupCol[]>(
    () =>
      (search.roomGroups ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string): s is RoomGroupCol =>
          (ROOM_GROUP_ORDER as readonly string[]).includes(s),
        ),
    [search.roomGroups],
  );

  const { options: dataDateOptions, latest: latestDataDate } = useDefectLatestDataDate();
  const [sharedAsOf, setSharedAsOf] = useSnagAsOf();
  // As-of 단일 규칙: 선택값 없으면 오늘(Asia/Qatar). data_date 폴백 금지.
  const effectiveDataDate = (search.dataDate as string) || sharedAsOf || todayInDoha();
  useEffect(() => {
    const v = (search.dataDate as string) || "";
    if (v !== sharedAsOf) setSharedAsOf(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.dataDate]);

  // Plot/Team은 스테이징: 변경해도 서버 재호출 없음, '재계산' 버튼으로 적용
  const [stagedPlot, setStagedPlot] = useState<PlotKey>(appliedPlot);
  const [stagedTeams, setStagedTeams] = useState<TeamKey[]>(appliedTeams);

  // URL 변경(뒤로가기/공유 링크 진입 등) 시 스테이징 값도 동기화
  useEffect(() => {
    setStagedPlot(appliedPlot);
    setStagedTeams(appliedTeams);
  }, [appliedPlot, appliedTeams]);

  const { data: rawRows = [], isLoading, error } = useSnagDashboardMatrix(
    appliedPlot,
    appliedTeams,
    effectiveDataDate || null,
  );
  const filteredRows = useMemo(() => {
    if (appliedRoomGroups.length === 0) return rawRows;
    const set = new Set<RoomGroupCol>(appliedRoomGroups);
    return rawRows.filter((r) => set.has(normalizeRoomGroup(r.room_group)));
  }, [rawRows, appliedRoomGroups]);
  const matrix = useMemo(
    () => buildMatrix(appliedPlot, appliedTeams, filteredRows),
    [appliedPlot, appliedTeams, filteredRows],
  );

  const teamsStr = search.teams ?? "";
  const rgStr = search.roomGroups ?? "";

  const teamKey = (t: TeamKey[]) => [...t].sort().join(",");
  const isDirty =
    stagedPlot !== appliedPlot || teamKey(stagedTeams) !== teamKey(appliedTeams);

  const applyFilters = () => {
    if (!isDirty) return;
    navigate({
      to: "/closure/snag-management/dashboard",
      search: {
        plot: stagedPlot,
        teams: stagedTeams.join(","),
        roomGroups: rgStr,
      },
    });
  };

  const resetStaged = () => {
    setStagedPlot(appliedPlot);
    setStagedTeams(appliedTeams);
  };

  const setRoomGroups = (rgs: RoomGroupCol[]) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: { plot: appliedPlot, teams: teamsStr, roomGroups: rgs.join(",") },
    });

  function roomGroupParam(col: RoomGroupCol): string {
    if (col === "FACADE") return "FACADE,LANDSCAPE";
    if (col === "N/A") return "__EMPTY__";
    return col;
  }

  const goRaw = (params: Record<string, string>) => {
    const planGroups = planGroupsForPlot(appliedPlot).join(",");
    // 필터 활성 시 roomGroup 파라미터 병합 (호출 측 지정이 우선)
    const rgParam =
      appliedRoomGroups.length > 0
        ? Array.from(
            new Set(
              appliedRoomGroups
                .flatMap((rg) => roomGroupParam(rg).split(","))
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ).join(",")
        : "";
    const merged: Record<string, string> = {
      source: "dashboard",
      plan_group: planGroups,
      ...(appliedTeams.length ? { team: appliedTeams.join(",") } : {}),
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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Snagging List Dashboard</h1>
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {asOfHeaderLabel(effectiveDataDate)}
            </span>
            <DataDatePicker
                showDataDateChip
                value={effectiveDataDate}
                latest={latestDataDate ?? ""}
                options={dataDateOptions}
                onChange={(v) =>
                  navigate({
                    to: "/closure/snag-management/dashboard",
                    search: (prev: Record<string, unknown>) =>
                      ({ ...prev, dataDate: v === todayInDoha() ? "" : v }) as any,
                  })
                }
                onReset={() =>
                  navigate({
                    to: "/closure/snag-management/dashboard",
                    search: (prev: Record<string, unknown>) =>
                      ({ ...prev, dataDate: "" }) as any,
                  })
                }
              />
          </div>
          <p className="text-xs text-muted-foreground">
            Plot · Building · Level × Room Group 매트릭스. 셀·헤더 클릭 시 Raw Data 드릴다운.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={stagedPlot} onValueChange={(v) => setStagedPlot(v as PlotKey)}>
            <TabsList>
              <TabsTrigger value="C">Plot C (+Tower 3)</TabsTrigger>
              <TabsTrigger value="D">Plot D (+Tower 4)</TabsTrigger>
            </TabsList>
          </Tabs>
          <DeSnagToolbar teams={stagedTeams} onChange={setStagedTeams} />
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              변경된 필터 적용 필요
            </span>
          )}
          <Button size="sm" onClick={applyFilters} disabled={!isDirty}>
            재계산
          </Button>
          <Button size="sm" variant="ghost" onClick={resetStaged} disabled={!isDirty}>
            초기화
          </Button>
        </div>
      </div>

      <DeSnagRoomGroupFilterBar selected={appliedRoomGroups} onChange={setRoomGroups} />

      {/* Plot Grand Total — KPI 카드 */}
      <DeSnagGrandTotalCards
        plot={appliedPlot}
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
