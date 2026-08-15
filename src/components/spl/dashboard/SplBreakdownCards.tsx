import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SplCatalogEntry, SplRow } from "@/lib/spl/rows.functions";
import {
  SPL_STAGE_STATES,
  SPL_STATE_LABEL,
  SPL_STATE_TEXT,
  splStateBarStyle,
  type SplStageState,
} from "@/lib/spl/stage-state";

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

type Counts = Record<SplStageState, number>;
const emptyCounts = (): Counts => ({ done: 0, wip: 0, delayed: 0, planned: 0, none: 0, na: 0 });

function TeamSplit({
  entries,
  onPick,
}: {
  entries: Array<[string, { done: number; total: number }]>;
  onPick?: (team: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex max-h-[84px] flex-wrap items-start gap-1 overflow-y-auto">
      {entries.map(([t, v]) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick?.(t)}
          className="rounded border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:bg-muted"
        >
          {t}{" "}
          <span className="font-semibold text-foreground">{v.done.toLocaleString()}</span>
          <span className="text-muted-foreground">/{v.total.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 대시보드 하단 보조 KPI.
 * 1행: 전체(팀별) · Completed(팀별) · 밴드별 진도율
 * 2행: 밴드별 단계 상태 현황 카드 3장
 * 모든 수치는 정본 `spl_rows_as_of` 가 내려준 값(judgment / stages[].st)을 세기만 한다.
 */
export function SplBreakdownCards({
  rows,
  catalog,
  asOf,
  onTeam,
  onDrill,
}: {
  rows: SplRow[];
  catalog: SplCatalogEntry[];
  /** 기준일 (YYYY-MM-DD) — 계획% 산출 기준 */
  asOf?: string;
  onTeam?: (team: string) => void;
  onDrill?: (patch: Record<string, unknown>) => void;
}) {
  const lanes = useMemo(() => {
    const byBand = new Map<string, SplCatalogEntry[]>();
    for (const c of [...catalog].sort((a, b) => a.sort_order - b.sort_order)) {
      const list = byBand.get(c.band) ?? [];
      list.push(c);
      byBand.set(c.band, list);
    }
    return [...byBand.entries()].sort((a, b) => a[1][0].sort_order - b[1][0].sort_order);
  }, [catalog]);

  const doneRows = useMemo(() => rows.filter((r) => r.judgment === "완료"), [rows]);

  /** 팀별 완료/전체 */
  const teamSplit = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const r of rows) {
      const k = r.team || "(미지정)";
      const v = m.get(k) ?? { done: 0, total: 0 };
      v.total += 1;
      if (r.judgment === "완료") v.done += 1;
      m.set(k, v);
    }
    return [...m.entries()].sort((x, y) => y[1].total - x[1].total);
  }, [rows]);

  /** 밴드별 단계 상태 합계 (행 × 단계) */
  const bandCounts = useMemo(() => {
    const m = new Map<string, Counts>();
    for (const [band] of lanes) m.set(band, emptyCounts());
    for (const r of rows) {
      for (const [band, stages] of lanes) {
        const box = m.get(band)!;
        for (const c of stages) {
          const st = (r.stages[c.stage_code]?.st ?? "none") as SplStageState;
          box[st] += 1;
        }
      }
    }
    return m;
  }, [lanes, rows]);

  const bandProgress = useMemo(() => {
    const m = new Map<string, { done: number; total: number; pct: number }>();
    for (const [band] of lanes) {
      const c = bandCounts.get(band) ?? emptyCounts();
      const total = c.done + c.wip + c.delayed + c.planned + c.none;
      m.set(band, { done: c.done, total, pct: total === 0 ? 0 : Math.round((c.done * 1000) / total) / 10 });
    }
    return m;
  }, [lanes, bandCounts]);

  const donePct = rows.length === 0 ? 0 : Math.round((doneRows.length * 1000) / rows.length) / 10;

  /** 실적% / 계획% — 단계 셀 기준 (na 제외). 계획%는 계획완료일(pf)이 기준일 이하인 셀 비율 */
  const perf = useMemo(() => {
    let denom = 0;
    let done = 0;
    let plan = 0;
    for (const r of rows) {
      for (const [, stages] of lanes) {
        for (const c of stages) {
          const cell = r.stages[c.stage_code];
          if (!cell || cell.na) continue;
          denom += 1;
          if (cell.st === "done") done += 1;
          if (asOf && cell.pf && cell.pf <= asOf) plan += 1;
        }
      }
    }
    const pct = (n: number) => (denom === 0 ? 0 : Math.round((n * 1000) / denom) / 10);
    return { actualPct: pct(done), planPct: pct(plan) };
  }, [rows, lanes, asOf]);

  /** 지연 — 행 단위(어느 단계든 delayed) 및 밴드별 행 수 */
  const delay = useMemo(() => {
    const byBand = new Map<string, number>();
    for (const [band] of lanes) byBand.set(band, 0);
    let total = 0;
    for (const r of rows) {
      let any = false;
      for (const [band, stages] of lanes) {
        const hit = stages.some((c) => r.stages[c.stage_code]?.st === "delayed");
        if (hit) {
          byBand.set(band, (byBand.get(band) ?? 0) + 1);
          any = true;
        }
      }
      if (any) total += 1;
    }
    return { total, byBand };
  }, [rows, lanes]);

  return (
    <div className="space-y-2">
      {/* 1행 */}
      <div className="grid gap-2 lg:grid-cols-3">
        {/* 통합 KPI — 진행수/전체수 · 팀별 · 실적%/계획% */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-[112px] space-y-1">
                <span className="text-[11px] text-muted-foreground">Completed / Total</span>
                <div className="flex items-baseline gap-1">
                  <button
                    type="button"
                    onClick={() => onDrill?.({ judgment: "완료" })}
                    className="text-3xl font-semibold tabular-nums text-[color:var(--success)] hover:underline"
                  >
                    {doneRows.length.toLocaleString()}
                  </button>
                  <span className="text-lg tabular-nums text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => onDrill?.({ judgment: "all" })}
                    className="text-lg font-medium tabular-nums text-muted-foreground hover:underline"
                  >
                    {rows.length.toLocaleString()}
                  </button>
                </div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  실적 <span className="font-semibold text-foreground">{perf.actualPct}%</span>
                  <span className="mx-1">/</span>
                  계획 <span className="font-semibold text-foreground">{perf.planPct}%</span>
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground">진도 {donePct}%</div>
              </div>
              <div className="flex-1">
                <TeamSplit entries={teamSplit} onPick={onTeam} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 p-3">
            <span className="text-[11px] text-muted-foreground">밴드별 진도율</span>
            <div className="space-y-1.5">
              {lanes.map(([band]) => {
                const p = bandProgress.get(band) ?? { done: 0, total: 0, pct: 0 };
                return (
                  <div key={band} className="space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate">{BAND_LABEL[band] ?? band}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {p.done.toLocaleString()} / {p.total.toLocaleString()}
                        <span className="ml-1 font-semibold text-foreground">{p.pct}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded"
                        style={{ width: `${Math.min(100, p.pct)}%`, background: "var(--success)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 지연 KPI */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-[92px] space-y-1">
                <span className="text-[11px] text-muted-foreground">지연 (Delayed)</span>
                <div>
                  <button
                    type="button"
                    onClick={() => onDrill?.({ judgment: "지연" })}
                    className="text-3xl font-semibold tabular-nums text-[color:var(--destructive)] hover:underline"
                  >
                    {delay.total.toLocaleString()}
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground">단계 지연 보유 항목</div>
              </div>
              <div className="flex-1 space-y-1">
                {lanes.map(([band]) => (
                  <div key={band} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate text-muted-foreground">{BAND_LABEL[band] ?? band}</span>
                    <span className="font-semibold tabular-nums">
                      {(delay.byBand.get(band) ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2행 — 밴드별 현황 갯수 */}
      <div className="grid gap-2 lg:grid-cols-3">
        {lanes.map(([band, stages]) => {
          const c = bandCounts.get(band) ?? emptyCounts();
          const sum = SPL_STAGE_STATES.reduce((a, s) => a + c[s], 0);
          return (
            <Card key={band}>
              <CardContent className="space-y-1.5 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium">{BAND_LABEL[band] ?? band}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    단계 {stages.length} · 합계 {sum.toLocaleString()}
                  </span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded">
                  {SPL_STAGE_STATES.map((s) =>
                    c[s] === 0 ? null : (
                      <div key={s} style={{ ...splStateBarStyle(s), width: `${(c[s] / (sum || 1)) * 100}%` }} />
                    ),
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {SPL_STAGE_STATES.map((s) => (
                    <div key={s} className="rounded border px-1.5 py-1">
                      <div className="text-[10px] text-muted-foreground">{SPL_STATE_LABEL[s]}</div>
                      <div className={cn("text-sm font-semibold tabular-nums", SPL_STATE_TEXT[s])}>
                        {c[s].toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
