import { useMemo } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha, formatDdMmm } from "@/lib/time/doha";
import { cn } from "@/lib/utils";
import { getSplRowsAsOf, type SplCatalogEntry, type SplRow } from "@/lib/spl/rows.functions";
import {
  SPL_STAGE_STATES,
  SPL_STATE_LABEL,
  SPL_STATE_TEXT,
  SPL_NA_HATCH,
  splStateBarStyle,
  type SplStageState,
} from "@/lib/spl/stage-state";
import { SplStageBox, type StageCounts } from "./SplStageBox";
import { SplColumnOrderMenu } from "@/components/spl/raw-data/SplColumnOrderMenu";
import { useSplColumnPrefs } from "@/components/spl/raw-data/useSplColumnPrefs";
import { splBandHeaderClass, type SplStageColumn } from "@/components/spl/raw-data/spl-columns";

const routeApi = getRouteApi("/_authenticated/closure/spare-part/progress");

const BAND_TAG: Record<string, { tag: string; label: string; note: string }> = {
  REQUIRED_DOC: { tag: "R", label: "Required Doc", note: "게이트" },
  DOCUMENTATION: { tag: "D", label: "Documentation", note: "" },
  PO: { tag: "P", label: "PO", note: "병행 진행" },
};

const emptyCounts = (): StageCounts => ({ done: 0, wip: 0, delayed: 0, planned: 0, none: 0, na: 0 });

export function SplProgressPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const rootNavigate = useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getSplRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["spl-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
  });

  type ProgressSearch = typeof search;
  const setSearch = (patch: Partial<ProgressSearch>) =>
    (navigate as (opts: unknown) => void)({
      to: "/closure/spare-part/progress",
      search: (prev: ProgressSearch) => ({ ...prev, ...patch }),
    });

  const catalog: SplCatalogEntry[] = data?.catalog ?? [];
  const rows = data?.rows ?? [];

  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(),
    [rows],
  );

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
    const byBand = new Map<string, SplCatalogEntry[]>();
    for (const c of [...catalog].sort((a, b) => a.sort_order - b.sort_order)) {
      const list = byBand.get(c.band) ?? [];
      list.push(c);
      byBand.set(c.band, list);
    }
    return [...byBand.entries()].sort((a, b) => a[1][0].sort_order - b[1][0].sort_order);
  }, [catalog]);

  /** 단계별 여섯 칸 — DB 가 준 st 를 세기만 한다 */
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

  /**
   * 「지금 여기」 — 레인(밴드)별로 따로 계산한다.
   * rows[].current_stage 는 활성 밴드 하나 안에서만 고르므로 PO 레인이 통째로 비어 쓸 수 없다.
   */
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

  const laneHere = useMemo(() => {
    const m = new Map<string, number>();
    for (const [band, stages] of lanes) {
      m.set(band, stages.reduce((a, c) => a + (hereCounts.get(c.stage_code) ?? 0), 0));
    }
    return m;
  }, [lanes, hereCounts]);

  /** R 레인 게이트 — 행별로 이미 내려온 값을 합산만 한다 */
  const gate = useMemo(() => {
    const n = filtered.reduce((a, r) => a + (r.req_doc_done ?? 0), 0);
    const N = filtered.reduce((a, r) => a + (r.req_doc_total ?? 0), 0);
    // 미충족 = Raw Data 의 reqDocShort=1 과 같은 술어
    const short = filtered.filter(
      (r) => (r.req_doc_total ?? 0) > 0 && (r.req_doc_done ?? 0) < (r.req_doc_total ?? 0),
    ).length;
    return { n, N, short, pct: N === 0 ? 0 : Math.round((n * 1000) / N) / 10 };
  }, [filtered]);

  const selectedStage = search.stage ? catalog.find((c) => c.stage_code === search.stage) ?? null : null;
  const selectedState = (search.stageState ?? null) as SplStageState | null;

  const detailRows = useMemo(() => {
    if (!selectedStage) return [] as SplRow[];
    return filtered.filter((r) => {
      const st = r.stages[selectedStage.stage_code]?.st ?? "none";
      return selectedState ? st === selectedState : st !== "na" && st !== "none";
    });
  }, [filtered, selectedStage, selectedState]);

  const pick = (stage_code: string, state: SplStageState | null) => {
    if (search.stage === stage_code && (search.stageState ?? null) === state) {
      setSearch({ stage: "", stageState: undefined });
      return;
    }
    setSearch({ stage: stage_code, stageState: state ?? undefined });
  };

  const slipDays = (r: SplRow, code: string): number | null => {
    const cell = r.stages[code];
    const plan = cell?.pf ?? cell?.ps;
    if (!plan) return null;
    const d = Math.floor((Date.parse(asOf) - Date.parse(plan)) / 86_400_000);
    return d > 0 ? d : null;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spare Part List — Progress</h1>
          <p className="text-xs text-muted-foreground">
            단계 상태는 정본(spl_rows_as_of → spl_eval_as_of → spl_stage_state)이 내려준 값을 세기만 합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "C", "D"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={(search.plot ?? "all") === p ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setSearch({ plot: p })}
            >
              {p === "all" ? "All Plots" : `PLOT-${p}`}
            </Button>
          ))}
          {["all", ...teams].map((t) => (
            <Button
              key={t}
              size="sm"
              variant={(search.team ?? "all") === t ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setSearch({ team: t })}
            >
              {t === "all" ? "All Teams" : t}
            </Button>
          ))}
          <DataDatePicker
            value={search.asOf ?? ""}
            latest={data?.as_of ?? today}
            options={[]}
            onChange={(v) => setSearch({ asOf: v })}
            onReset={() => setSearch({ asOf: "" })}
          />
        </div>
      </div>

      {/* 범례 — 화면 위에 한 줄 */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>단계 상태</span>
        {SPL_STAGE_STATES.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-3.5 rounded-[2px] border"
              style={s === "na" ? { backgroundImage: SPL_NA_HATCH } : splStateBarStyle(s)}
            />
            <span className={cn(SPL_STATE_TEXT[s])}>{SPL_STATE_LABEL[s]}</span>
          </span>
        ))}
        <span className="ml-auto tabular-nums">대상 {filtered.length.toLocaleString()} 건</span>
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
          {lanes.map(([band, stages]) => (
            <Card key={band}>
              <CardContent className="flex items-stretch gap-3 p-2">
                <div className="w-[130px] shrink-0">
                  <div className="inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
                    <span className="rounded-sm border px-1 text-[10px]">{BAND_TAG[band]?.tag ?? band[0]}</span>
                    {BAND_TAG[band]?.label ?? band}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {stages.length}단계
                    {BAND_TAG[band]?.note ? ` · ${BAND_TAG[band].note}` : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    진행 중 {(laneHere.get(band) ?? 0).toLocaleString()} 건
                  </div>
                </div>

                <div className="flex flex-1 items-stretch gap-[10px] overflow-x-auto pb-1">
                  {band === "REQUIRED_DOC" && (
                    <div className="min-w-[190px] shrink-0 rounded-lg border p-2">
                      <div className="text-[11px] font-semibold">REQUIRED DOCUMENT</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {gate.n.toLocaleString()} / {gate.N.toLocaleString()}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">ready</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded bg-muted">
                        <div
                          className="h-2 rounded"
                          style={{ width: `${gate.pct}%`, background: "var(--success)" }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">{gate.pct}%</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 h-6 w-full text-[10px]"
                        onClick={() =>
                          (rootNavigate as (opts: unknown) => void)({
                            to: "/closure/spare-part/raw-data",
                            search: {
                              asOf: search.asOf ?? "",
                              plot: search.plot ?? "all",
                              team: search.team ?? "all",
                              reqDocShort: true,
                            },
                          })
                        }
                      >
                        미충족 {gate.short.toLocaleString()}건
                      </Button>
                    </div>
                  )}
                  {stages.map((c, i) => (
                    <div key={c.stage_code} className="flex items-center gap-[10px]">
                      {i > 0 && band !== "REQUIRED_DOC" && (
                        <span className="text-[color:var(--border)]" aria-hidden>
                          ›
                        </span>
                      )}
                      {band === "REQUIRED_DOC" ? (
                        <ReqDocCell
                          code={c.short_code}
                          label={c.label}
                          required={filtered.filter(
                            (r) =>
                              (r.stages[c.stage_code]?.fv ?? "").trim().toUpperCase() === "REQUIRED",
                          ).length}
                          withActual={filtered.filter(
                            (r) =>
                              (r.stages[c.stage_code]?.fv ?? "").trim().toUpperCase() === "REQUIRED" &&
                              !!(r.stages[c.stage_code]?.as ?? r.stages[c.stage_code]?.af),
                          ).length}
                        />
                      ) : (
                        <SplStageBox
                          code={c.short_code}
                          label={c.label}
                          counts={stageCounts.get(c.stage_code) ?? emptyCounts()}
                          hereCount={hereCounts.get(c.stage_code) ?? 0}
                          aconex={c.actual_authority === "ACONEX"}
                          roundNo={c.round_no}
                          active={search.stage === c.stage_code}
                          activeState={selectedState}
                          onPick={(st) => pick(c.stage_code, st)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {selectedStage && (
            <Card>
              <CardContent className="p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold">
                    {selectedStage.short_code} · {selectedStage.label}
                  </div>
                  <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {selectedState ? SPL_STATE_LABEL[selectedState] : "전체(해당없음·자료없음 제외)"}{" "}
                    {detailRows.length.toLocaleString()}건
                  </span>
                  <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    기준일 {asOf}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      (rootNavigate as (opts: unknown) => void)({
                        to: "/closure/spare-part/raw-data",
                        search: {
                          asOf: search.asOf ?? "",
                          plot: search.plot ?? "all",
                          team: search.team ?? "all",
                          stage: selectedStage.stage_code,
                          stageState: selectedState ?? undefined,
                        },
                      })
                    }
                  >
                    Raw Data 에서 보기
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => setSearch({ stage: "", stageState: undefined })}
                  >
                    닫기
                  </Button>
                </div>
                <div className="max-h-[420px] overflow-auto rounded border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-2 py-1">SPL NUMBER</th>
                        <th className="px-2 py-1">Title</th>
                        <th className="px-2 py-1">Team</th>
                        <th className="px-2 py-1">Plot</th>
                        <th className="px-2 py-1">PIC / ENG</th>
                        <th className="px-2 py-1">Plan</th>
                        <th className="px-2 py-1">Actual</th>
                        <th className="px-2 py-1 text-right">Slip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((r) => {
                        const cell = r.stages[selectedStage.stage_code];
                        const slip = slipDays(r, selectedStage.stage_code);
                        return (
                          <tr
                            key={r.id}
                            className="cursor-pointer border-b hover:bg-muted/50"
                            onClick={() =>
                              (rootNavigate as (opts: unknown) => void)({
                                to: "/closure/spare-part/detail/$id",
                                params: { id: r.id },
                              })
                            }
                          >
                            <td className="px-2 py-1 font-medium">{r.spl_number}</td>
                            <td className="max-w-[320px] truncate px-2 py-1" title={r.title ?? ""}>
                              {r.title}
                            </td>
                            <td className="px-2 py-1">{r.team}</td>
                            <td className="px-2 py-1">{r.plot}</td>
                            <td className="px-2 py-1">
                              {[r.pic, r.eng].filter(Boolean).join(" / ")}
                            </td>
                            <td className="px-2 py-1 tabular-nums">
                              {cell?.pf ? formatDdMmm(cell.pf) : cell?.ps ? formatDdMmm(cell.ps) : ""}
                            </td>
                            <td className="px-2 py-1 tabular-nums">
                              {cell?.af ? formatDdMmm(cell.af) : cell?.as ? formatDdMmm(cell.as) : ""}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums text-[color:var(--destructive)]">
                              {slip ?? ""}
                            </td>
                          </tr>
                        );
                      })}
                      {detailRows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                            해당 행이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** R 레인 flag 단계 — REQUIRED 건수와 실적 보유 건수 */
function ReqDocCell({
  code,
  label,
  required,
  withActual,
}: {
  code: string;
  label: string;
  required: number;
  withActual: number;
}) {
  return (
    <div className="min-w-[126px] shrink-0 rounded-lg border p-2" title={`${label} — REQUIRED ${required} · 실적 ${withActual}`}>
      <div className="text-[11px] font-semibold">{code}</div>
      <div className="truncate text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        <span className="text-[color:var(--success)]">{withActual.toLocaleString()}</span>
        <span className="text-muted-foreground"> / {required.toLocaleString()}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">실적 / REQUIRED</div>
    </div>
  );
}
