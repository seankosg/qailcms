import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Route as DashboardRoute } from "@/routes/_authenticated/closure/snag-management/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeSnagToolbar } from "./DeSnagToolbar";
import { DeSnagMatrixBlock, type MatrixMode } from "./DeSnagMatrixBlock";
import { DeSnagGrandTotalCards } from "./DeSnagGrandTotalCards";
import { DeSnagRoomGroupCards } from "./DeSnagRoomGroupCards";
import { DeSnagRoomGroupFilterBar } from "./DeSnagRoomGroupFilterBar";
import { exportSnagMatrixToXlsx } from "@/lib/defect-management/matrix-excel";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useSnagDashboardMatrix } from "@/hooks/useSnagDashboardMatrix";
import { useDefectLatestDataDate } from "@/hooks/useDefectLatestDataDate";
import { useSnagAsOf } from "@/hooks/useSnagAsOf";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
import {
  ALL_TEAMS,
  buildMatrix,
  isLgRoomGroup,
  LG_ROOM_GROUPS,
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
          (ROOM_GROUP_ORDER as readonly string[]).includes(s) ||
          (LG_ROOM_GROUPS as readonly string[]).includes(s),
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
  const rawMode = (search as any).matrixMode as string;
  const matrixMode: MatrixMode = (["pct", "remain", "remainPct"] as const).includes(
    rawMode as any,
  )
    ? (rawMode as MatrixMode)
    : "count";
  const isRemainMode = matrixMode === "remain" || matrixMode === "remainPct";

  // Plot/Team 변경은 즉시 적용(자동 재계산)
  const setTeamsImmediate = (t: TeamKey[]) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: (prev: Record<string, unknown>) => ({ ...prev, teams: t.join(",") }) as any,
    });

  const setRoomGroups = (rgs: RoomGroupCol[]) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: { plot: appliedPlot, teams: teamsStr, roomGroups: rgs.join(",") },
    });

  // 개수/% 토글 — 상단 필터 탭과 완전 독립 (다른 파라미터 보존)
  const setMatrixMode = (m: MatrixMode) =>
    navigate({
      to: "/closure/snag-management/dashboard",
      search: (prev: Record<string, unknown>) =>
        ({ ...prev, matrixMode: m === "count" ? "" : m }) as any,
    });

  // 매트릭스 상단 Plot 탭 — 즉시 적용 (다른 파라미터 보존)
  const setPlotTab = (p: PlotKey) => {
    navigate({
      to: "/closure/snag-management/dashboard",
      search: (prev: Record<string, unknown>) => ({ ...prev, plot: p }) as any,
    });
  };

  function roomGroupParam(col: RoomGroupCol): string {
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
    // 정본 동치 드릴다운: 실적일 스테이지 셀은 as-of 를 상한으로 건다.
    if (merged.dateField) merged.dateEnd = effectiveDataDate;
    // Issued/Rect 셀은 Closed 항목도 포함하므로 전체 탭으로 진입해야 숫자가 일치한다.
    if (!merged.tab) merged.tab = "all";
    navigate({ to: "/closure/snag-management/raw-data", search: merged as any });
  };

  const presentPodiumBuildings = useMemo(() => {
    const b = matrix.blocks.find((x) => x.kind === "podium");
    if (!b) return [] as string[];
    return Array.from(new Set(b.rows.map((r) => r.building)));
  }, [matrix]);

  const roomGroupEntries = useMemo(() => {
    // 블록 배치(LIFT CABIN 등)와 무관하게 원본 room_group 기준 정본 집계를 사용한다.
    const totals = matrix.roomGroupTotals as Record<string, Stats>;
    const get = (rg: string) => totals[rg] ?? newStats();
    const paramFor = (col: string) => {
      const src = matrix.roomGroupSourceMap[col] ?? [];
      if (src.length === 0) return col === "N/A" ? "__EMPTY__" : col;
      return src.join(",");
    };
    // 카드 목록은 실제 집계 키에서 유도한다 (고정 상수 전체 나열 금지).
    // 상수 순서 우선, 상수에 없는 신규 표기는 뒤에 알파벳 순.
    const orderIdx = (c: string) => {
      const i = (ROOM_GROUP_ORDER as readonly string[]).indexOf(c);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const selected = new Set<string>(appliedRoomGroups as unknown as string[]);
    const cols = Object.keys(totals)
      .filter((c) => !isLgRoomGroup(c))
      .filter((c) => (selected.size === 0 ? true : selected.has(c)))
      .filter((c) => get(c).issued > 0)
      .sort((a, b) => {
        const d = orderIdx(a) - orderIdx(b);
        return d !== 0 ? d : a.localeCompare(b);
      });
    const base = cols.map((col) => ({
      col,
      label: col,
      param: paramFor(col),
      stats: get(col),
    }));
    // LG (Lower Ground) — Podium 1~N 통합 카드
    const lgPresent = LG_ROOM_GROUPS.filter(
      (rg) => get(rg).issued > 0 && (selected.size === 0 || selected.has(rg)),
    );
    if (lgPresent.length > 0) {
      const lgStats = newStats();
      for (const rg of lgPresent) mergeStats(lgStats, get(rg));
      base.push({
        col: "__LG_PODIUM__",
        label: "LG Podium",
        param: lgPresent.flatMap((rg) => paramFor(rg).split(",")).join(","),
        stats: lgStats,
      });
    }
    return base;
  }, [matrix, appliedRoomGroups]);

  // 안내 문구용 — 데이터에 존재하는 전체 Room Group 수 (필터 적용 전)
  const roomGroupTotalCount = useMemo(() => {
    const totals = matrix.roomGroupTotals as Record<string, Stats>;
    const plain = Object.keys(totals).filter(
      (c) => !isLgRoomGroup(c) && (totals[c]?.issued ?? 0) > 0,
    ).length;
    const lg = LG_ROOM_GROUPS.some((rg) => (totals[rg]?.issued ?? 0) > 0) ? 1 : 0;
    return plain + lg;
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
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={appliedPlot} onValueChange={(v) => setPlotTab(v as PlotKey)}>
            <TabsList>
              <TabsTrigger value="C">Plot C (+Tower 3)</TabsTrigger>
              <TabsTrigger value="D">Plot D (+Tower 4)</TabsTrigger>
            </TabsList>
          </Tabs>
          <DeSnagToolbar teams={appliedTeams} onChange={setTeamsImmediate} />
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

      <DeSnagRoomGroupCards
        entries={roomGroupEntries}
        onNavigate={goRaw}
        totalGroups={roomGroupTotalCount}
      />

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {error && <p className="text-sm text-destructive">오류: {(error as Error).message}</p>}
      {!isLoading && !error && matrix.blocks.length === 0 && (
        <p className="text-sm text-muted-foreground">해당 조건의 데이터가 없습니다.</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Tabs value={appliedPlot} onValueChange={(v) => setPlotTab(v as PlotKey)}>
          <TabsList className="h-8">
            <TabsTrigger value="C" className="text-xs">PLOT C</TabsTrigger>
            <TabsTrigger value="D" className="text-xs">PLOT D</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs
          value={isRemainMode ? "" : matrixMode}
          onValueChange={(v) => v && setMatrixMode(v as MatrixMode)}
        >
          <TabsList className="h-8">
            <TabsTrigger value="count" className="text-xs">개수</TabsTrigger>
            <TabsTrigger value="pct" className="text-xs">%</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs
          value={isRemainMode ? matrixMode : ""}
          onValueChange={(v) => v && setMatrixMode(v as MatrixMode)}
        >
          <TabsList className="h-8 bg-amber-500/15">
            <TabsTrigger
              value="remain"
              className="text-xs data-[state=active]:bg-amber-500 data-[state=active]:text-white"
            >
              잔여 개수
            </TabsTrigger>
            <TabsTrigger
              value="remainPct"
              className="text-xs data-[state=active]:bg-amber-500 data-[state=active]:text-white"
            >
              잔여 %
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          disabled={matrix.blocks.length === 0}
          onClick={() => {
            try {
              exportSnagMatrixToXlsx({
                matrix,
                mode: matrixMode,
                asOf: effectiveDataDate,
                teams: appliedTeams,
                roomGroupsFilter: appliedRoomGroups,
              });
              toast.success("매트릭스를 엑셀로 내보냈습니다.");
            } catch (e) {
              toast.error(`엑셀 내보내기 실패: ${(e as Error).message}`);
            }
          }}
        >
          <Download className="h-3.5 w-3.5" />
          엑셀 다운로드
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Rect% · Closed% = 같은 팀의 Issued 대비. 팀별 최저 비율이 차상위보다 15%p 이상 낮으면 병목 강조.
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {matrix.blocks.map((block) => (
          <DeSnagMatrixBlock
            key={block.kind}
            block={block}
            mode={matrixMode}
            presentBuildings={block.kind === "podium" ? presentPodiumBuildings : []}
            onNavigate={goRaw}
          />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        각 셀 = Room Group × (Issued · Rect · Closed) × (Elec · Mech · Arch). Rect/Closed 는 정본(자기 실적일 ≤ 기준일) 기준.
      </p>
    </div>
  );
}
