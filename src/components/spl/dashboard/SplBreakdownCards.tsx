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
  entries: Array<[string, number]>;
  onPick?: (team: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex max-h-[68px] flex-wrap items-start gap-1 overflow-y-auto">
      {entries.map(([t, n]) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick?.(t)}
          className="rounded border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:bg-muted"
        >
          {t} <span className="font-semibold text-foreground">{n.toLocaleString()}</span>
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
  onTeam,
  onDrill,
}: {
  rows: SplRow[];
  catalog: SplCatalogEntry[];
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

  const teamAll = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.team || "(미지정)", (m.get(r.team || "(미지정)") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const doneRows = useMemo(() => rows.filter((r) => r.judgment === "완료"), [rows]);
  const teamDone = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of doneRows) m.set(r.team || "(미지정)", (m.get(r.team || "(미지정)") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [doneRows]);

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

  return (
    <div className="space-y-2">
      {/* 1행 */}
      <div className="grid gap-2 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-1.5 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">전체 (Population)</span>
              <button
                type="button"
                onClick={() => onDrill?.({ judgment: "all" })}
                className="text-2xl font-semibold tabular-nums hover:underline"
              >
                {rows.length.toLocaleString()}
              </button>
            </div>
            <TeamSplit entries={teamAll} onPick={onTeam} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1.5 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Completed</span>
              <span className="flex items-baseline gap-1.5">
                <button
                  type="button"
                  onClick={() => onDrill?.({ judgment: "완료" })}
                  className="text-2xl font-semibold tabular-nums text-[color:var(--success)] hover:underline"
                >
                  {doneRows.length.toLocaleString()}
                </button>
                <span className="text-[11px] tabular-nums text-muted-foreground">{donePct}%</span>
              </span>
            </div>
            <TeamSplit entries={teamDone} onPick={onTeam} />
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
