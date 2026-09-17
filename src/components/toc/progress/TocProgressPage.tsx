import { useMemo } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { getTocRowsAsOf, type TocCatalogEntry } from "@/lib/toc/rows.functions";
import {
  SPL_STAGE_STATES,
  SPL_STATE_LABEL,
  splStateBarStyle,
  type SplStageState,
} from "@/lib/spl/stage-state";
import { SplStageBox, type StageCounts } from "@/components/spl/progress/SplStageBox";
import { TOC_BANDS, TOC_BAND_STATE_COLOR, TOC_BAND_STATE_LABEL } from "@/lib/toc/columns";

const routeApi = getRouteApi("/_authenticated/closure/toc/progress");

const emptyCounts = (): StageCounts => ({ done: 0, wip: 0, delayed: 0, planned: 0, none: 0, na: 0 });

const BAND_META: Record<string, { tag: string; note: string }> = {
  TAC: { tag: "T", note: "게이트 — 교육 실적의 선행 조건" },
  OMM: { tag: "O", note: "" },
  TRAINING: { tag: "R", note: "교육 세션 정본에서 합성" },
  ASSET_TAG: { tag: "G", note: "" },
  ABD: { tag: "A", note: "" },
  SERVICE_REPORT: { tag: "S", note: "필요 항목만" },
  TOC: { tag: "H", note: "게이트 — 앞 밴드 완료 후" },
};

/**
 * Handover (TOC) Progress — SPL 진행 화면과 동일 구성.
 * 레인 = 정본 catalog 의 밴드 7개, 각 단계 상자는 정본이 내려준 `st`(6개 상태)만 센다.
 * 화면에서 판정·상태를 재계산하지 않으며, 클릭 시 Raw Data 로 같은 술어를 넘긴다.
 */
export function TocProgressPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const rootNavigate = useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getTocRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["toc-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: search.asOf || null } }),
  });

  const setSearch = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({ search: { ...search, ...patch }, replace: true });

  const catalog: TocCatalogEntry[] = data?.catalog ?? [];
  const rows = data?.rows ?? [];

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (search.plot && search.plot !== "all" && (r.plot ?? "") !== search.plot) return false;
        if (search.team && search.team !== "all" && (r.team ?? "") !== search.team) return false;
        return true;
      }),
    [rows, search.plot, search.team],
  );

  /** 레인 = catalog.band, 순서는 밴드 내 최소 sort_order */
  const lanes = useMemo(() => {
    const byBand = new Map<string, TocCatalogEntry[]>();
    for (const c of [...catalog].sort((a, b) => a.sort_order - b.sort_order)) {
      const list = byBand.get(c.band) ?? [];
      list.push(c);
      byBand.set(c.band, list);
    }
    return [...byBand.entries()].sort((a, b) => a[1][0].sort_order - b[1][0].sort_order);
  }, [catalog]);

  /** 단계별 여섯 칸 — 정본이 준 st 를 세기만 한다 */
  const stageCounts = useMemo(() => {
    const m = new Map<string, StageCounts>();
    for (const c of catalog) m.set(c.stage_code, emptyCounts());
    for (const r of filtered) {
      for (const c of catalog) {
        const st = (r.stages[c.stage_code]?.st ?? "none") as SplStageState;
        const box = m.get(c.stage_code)!;
        box[st] += 1;
      }
    }
    return m;
  }, [catalog, filtered]);

  /** Current Stage — 레인별로 따로 계산 (밴드가 병행 진행되므로) */
  const hereCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog) m.set(c.stage_code, 0);
    for (const [, stages] of lanes) {
      for (const r of filtered) {
        const hit = stages.find((c) => {
          const st = r.stages[c.stage_code]?.st ?? "none";
          return st !== "na" && st !== "none" && st !== "done";
        });
        if (hit) m.set(hit.stage_code, (m.get(hit.stage_code) ?? 0) + 1);
      }
    }
    return m;
  }, [lanes, filtered, catalog]);

  /** 레인 진도율 — N/A 제외 */
  const bandProgress = useMemo(() => {
    const m = new Map<string, { done: number; total: number; pct: number }>();
    for (const [band, stages] of lanes) {
      let done = 0;
      let total = 0;
      for (const c of stages) {
        const counts = stageCounts.get(c.stage_code) ?? emptyCounts();
        done += counts.done;
        total += counts.done + counts.wip + counts.delayed + counts.planned + counts.none;
      }
      m.set(band, { done, total, pct: total === 0 ? 0 : Math.round((done * 1000) / total) / 10 });
    }
    return m;
  }, [lanes, stageCounts]);

  /** 밴드 상태 분포 — 정본 band_states 합계 = 모집단 검산 */
  const bandStateCounts = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const [band] of lanes) {
      const c: Record<string, number> = { complete: 0, active: 0, planned: 0, blocked: 0, na: 0, empty: 0 };
      for (const r of filtered) {
        const st = r.band_states?.[band] ?? "empty";
        c[st] = (c[st] ?? 0) + 1;
      }
      m.set(band, c);
    }
    return m;
  }, [lanes, filtered]);

  /** T&C 게이트 — 교육 실적 입력의 선행 조건 충족 현황 */
  const gate = useMemo(() => {
    const complete = filtered.filter((r) => (r.band_states?.TAC ?? "") === "complete").length;
    const blockedTraining = filtered.filter(
      (r) => (r.band_states?.TAC ?? "") !== "complete" && (r.band_states?.TRAINING ?? "empty") !== "na",
    ).length;
    return { complete, total: filtered.length, blockedTraining };
  }, [filtered]);

  /** 상자 클릭 = Raw Data 드릴다운 */
  const drill = (stageCode: string, state: SplStageState | null) => {
    const c = catalog.find((x) => x.stage_code === stageCode);
    const filters: Record<string, unknown> = {};
    if (state && c) filters[`band_${c.band}`] = [stateToBandState(state)];
    (rootNavigate as (opts: unknown) => void)({
      to: "/closure/toc/raw-data",
      search: {
        asOf: search.asOf ?? "",
        tab: "all",
        filters: Object.keys(filters).length ? JSON.stringify(filters) : "",
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Handover (TOC) — Progress</h1>
          <p className="text-xs text-muted-foreground">
            레인 = 준비 밴드 {TOC_BANDS.length}개. 각 단계 상자의 여섯 칸은 정본 판정 결과를 센 것이며, 칸을 누르면 같은
            조건의 Raw Data 로 이동합니다.
          </p>
        </div>
        <DataDatePicker
          value={search.asOf ?? ""}
          latest={data?.as_of ?? today}
          options={[]}
          onChange={(v) => setSearch({ asOf: v })}
          onReset={() => setSearch({ asOf: "" })}
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : error ? (
        <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2">
            <span className="w-[52px] text-[11px] text-muted-foreground">Plot</span>
            {["all", "C", "D"].map((p) => (
              <Button
                key={p}
                size="sm"
                variant={(search.plot ?? "all") === p ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setSearch({ plot: p })}
              >
                {p === "all" ? "All Plots" : `PLOT-${p}`}
              </Button>
            ))}
            <span className="ml-3 w-[40px] text-[11px] text-muted-foreground">Team</span>
            {["all", ...teams].map((t) => (
              <Button
                key={t}
                size="sm"
                variant={(search.team ?? "all") === t ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setSearch({ team: t })}
              >
                {t === "all" ? "All Teams" : t}
              </Button>
            ))}
            <span className="ml-auto text-[11px] text-muted-foreground">
              As-of {data?.as_of ?? today} · Items {filtered.length.toLocaleString()}
            </span>
          </div>

          {/* T&C 게이트 */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 py-3 text-xs">
              <div>
                <div className="text-[11px] text-muted-foreground">T&amp;C 완료 (교육 실적 선행 조건)</div>
                <div className="text-lg font-semibold tabular-nums">
                  {gate.complete.toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground"> / {gate.total.toLocaleString()}</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">교육 실적 입력 차단</div>
                <div
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    gate.blockedTraining > 0 ? "text-destructive" : "text-emerald-600",
                  )}
                >
                  {gate.blockedTraining.toLocaleString()}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                T&amp;C 밴드가 완료되지 않은 항목에는 교육 실적을 저장할 수 없습니다 (정본 규칙).
              </div>
            </CardContent>
          </Card>

          {/* 레인 */}
          <div className="space-y-2">
            {lanes.map(([band, stages]) => {
              const bp = bandProgress.get(band) ?? { done: 0, total: 0, pct: 0 };
              const bsc = bandStateCounts.get(band) ?? {};
              const meta = BAND_META[band] ?? { tag: band.slice(0, 1), note: "" };
              const label = TOC_BANDS.find((b) => b.band === band)?.label ?? band;
              const bandSum = Object.values(bsc).reduce((a, b) => a + b, 0);
              return (
                <Card key={band}>
                  <CardContent className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[11px] font-bold">
                        {meta.tag}
                      </span>
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-[11px] text-muted-foreground">{meta.note}</span>
                      <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
                        진도 {bp.pct}% ({bp.done.toLocaleString()}/{bp.total.toLocaleString()})
                      </span>
                      <span className="ml-auto flex flex-wrap gap-1">
                        {(["complete", "active", "planned", "blocked", "na", "empty"] as const).map((s) => (
                          <span
                            key={s}
                            className={cn("rounded px-1.5 py-0.5 text-[10px] tabular-nums", TOC_BAND_STATE_COLOR[s])}
                            title={`${TOC_BAND_STATE_LABEL[s]} ${bsc[s] ?? 0}`}
                          >
                            {TOC_BAND_STATE_LABEL[s]} {bsc[s] ?? 0}
                          </span>
                        ))}
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px] tabular-nums",
                            bandSum !== filtered.length ? "border-destructive text-destructive" : "text-muted-foreground",
                          )}
                          title="밴드 상태 합계 = 모집단 검산"
                        >
                          합계 {bandSum}/{filtered.length}
                        </span>
                      </span>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {stages.map((c) => (
                        <SplStageBox
                          key={c.stage_code}
                          code={c.short_code || c.stage_code}
                          label={c.label}
                          counts={stageCounts.get(c.stage_code) ?? emptyCounts()}
                          hereCount={hereCounts.get(c.stage_code) ?? 0}
                          aconex={c.actual_authority !== "HDEC"}
                          active={search.stage === c.stage_code}
                          activeState={(search.state || null) as SplStageState | null}
                          onPick={(st) => {
                            setSearch({ stage: c.stage_code, state: st ?? "" });
                            drill(c.stage_code, st);
                          }}
                        />
                      ))}
                    </div>

                    {/* 레인 스택바 */}
                    <div className="flex h-1.5 gap-[2px]">
                      {SPL_STAGE_STATES.map((s) => {
                        const n = stages.reduce((a, c) => a + (stageCounts.get(c.stage_code)?.[s] ?? 0), 0);
                        if (n === 0) return null;
                        return (
                          <div
                            key={s}
                            className="rounded-[1px]"
                            style={{ ...splStateBarStyle(s), flexGrow: n, flexBasis: 0 }}
                            title={`${SPL_STATE_LABEL[s]} ${n}`}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** 단계 상태(6종) → 밴드 상태(Raw Data 밴드 컬럼 필터 값) 근사 매핑 */
function stateToBandState(s: SplStageState): string {
  if (s === "done") return "complete";
  if (s === "wip" || s === "delayed") return "active";
  if (s === "planned") return "planned";
  if (s === "na") return "na";
  return "empty";
}
