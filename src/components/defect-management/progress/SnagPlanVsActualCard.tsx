import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  ALL_STAGES,
  STAGE_LABELS,
  type CellRaw,
  type Stage,
} from "@/lib/defect-management/progress-utils";
import {
  buildSnagSCurve,
  SNAG_STAGE_COLORS,
  type SnagSCurveCum,
} from "@/lib/defect-management/scurve-utils";
import { bucketTargetTerm } from "@/lib/charts/bucket-terms";
import {
  ProgressChartLegend,
  VarianceLegend,
  defaultMetrics,
} from "@/components/shared/charts/ProgressChartLegend";
import { useProgressLegend } from "@/components/shared/charts/useProgressLegend";

const METRIC_KEYS = ["periodPlan", "periodActual", "cumPlan", "cumActual"];
const METRIC_PREFIX: Record<string, string> = {
  periodPlan: "planInc",
  periodActual: "actualInc",
  cumPlan: "cumPlan",
  cumActual: "cumActual",
};

export interface SnagPlanVsActualCardProps {
  cells: CellRaw[];
  buckets: string[];
  stages: Stage[];
  today: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 서버 정본 누계(있으면 곡선에 사용). 막대는 항상 cells 기반 일일 절대값. */
  cum?: SnagSCurveCum;
  /** 시간 단위(day/week/month) — 막대 라벨 용어 */
  bucket?: string;
  /** 스테이지별 모수(분모) — 누계 곡선을 진도율 %로 그린다 */
  denomByStage?: Partial<Record<Stage, number>>;
}

export function SnagPlanVsActualCard({
  cells,
  buckets,
  stages,
  today,
  open,
  onOpenChange,
  cum,
  bucket,
  denomByStage,
}: SnagPlanVsActualCardProps) {
  const term = bucketTargetTerm(bucket);
  const scurve = useMemo(
    () => buildSnagSCurve({ cells, buckets, stages, today, cum }),
    [cells, buckets, stages, today, cum],
  );

  const legend = useProgressLegend({
    metricKeys: METRIC_KEYS,
    seriesKeys: stages as unknown as string[],
    dataKey: (m, s) => `${METRIC_PREFIX[m]}_${s}`,
  });
  const hidden = legend.hidden;

  const stageLabelShort: Record<Stage, string> = { ...STAGE_LABELS };

  const data = scurve.bucketLabels.map((label, i) => {
    const row: Record<string, unknown> = {
      bucket: scurve.buckets[i],
      bucketLabel: label,
    };
    let varSum: number | null = 0;
    let anyNull = false;
    for (const s of stages) {
      const ser = scurve.series[s];
      row[`planInc_${s}`] = ser.dailyPlan[i];
      row[`actualInc_${s}`] = ser.dailyActual[i];
      const denom = denomByStage?.[s] ?? 0;
      const toPct = (v: number | null) =>
        v == null ? null : denom > 0 ? Math.round((v / denom) * 1000) / 10 : null;
      row[`cumPlan_${s}`] = toPct(ser.cumPlan[i] as number | null);
      row[`cumActual_${s}`] = toPct(ser.cumActual[i] as number | null);
      const a = ser.dailyActual[i];
      const p = ser.dailyPlan[i];
      if (a == null) anyNull = true;
      else if (varSum != null) varSum += a - p;
    }
    row.variance = anyNull ? null : varSum;
    return row;
  });

  const todayLabel =
    scurve.todayIndex >= 0 ? scurve.bucketLabels[scurve.todayIndex] ?? null : null;

  const cfg: ChartConfig = Object.fromEntries(
    stages.flatMap((s) => [
      [`planInc_${s}`, { label: `${stageLabelShort[s]} Plan (${term})`, color: SNAG_STAGE_COLORS[s].bar }],
      [`actualInc_${s}`, { label: `${stageLabelShort[s]} Actual (${term})`, color: SNAG_STAGE_COLORS[s].line }],
      [`cumPlan_${s}`, { label: `${stageLabelShort[s]} Plan (누적 %)`, color: SNAG_STAGE_COLORS[s].line }],
      [`cumActual_${s}`, { label: `${stageLabelShort[s]} Actual (누적 %)`, color: SNAG_STAGE_COLORS[s].line }],
    ]),
  ) as ChartConfig;

  const varianceCfg: ChartConfig = {
    variance: { label: "Δ Actual − Plan", color: "hsl(var(--destructive))" },
  };

  const hasData = buckets.length > 0 && stages.length > 0;

  // KPI: 오늘 시점 스테이지별 P/A/Δ
  const idxForKpi = scurve.todayIndex >= 0 ? scurve.todayIndex : buckets.length - 1;
  const kpis = stages.map((s) => {
    const ser = scurve.series[s];
    const plan = ser.cumPlan[idxForKpi] ?? 0;
    const actual = ser.cumActual[idxForKpi] ?? 0;
    const delta = (actual as number) - plan;
    const pct = plan > 0 ? (delta / plan) * 100 : 0;
    return { stage: s, plan, actual, delta, pct };
  });

  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left hover:opacity-80"
              aria-expanded={open}
            >
              <div className="flex items-center gap-2">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <TrendingUp className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Plan vs Actual — S-Curve</CardTitle>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {ALL_STAGES.filter((s) => stages.includes(s)).map((s) => STAGE_LABELS[s]).join(" · ")}
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {!hasData ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data in range.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-stretch gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  {kpis.map((k) => {
                    const accent = k.delta < 0
                      ? "text-destructive"
                      : k.delta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground";
                    const sign = k.delta > 0 ? "+" : "";
                    return (
                      <div
                        key={k.stage}
                        className="flex flex-col gap-0.5 rounded border-l-4 px-3 py-1"
                        style={{ borderLeftColor: SNAG_STAGE_COLORS[k.stage].line }}
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {STAGE_LABELS[k.stage]}
                        </span>
                        <span className="text-xs tabular-nums">
                          <span className="text-muted-foreground">P</span> {k.plan.toLocaleString()}{" "}
                          · <span className="text-muted-foreground">A</span>{" "}
                          {(k.actual as number).toLocaleString()}
                        </span>
                        <span className={cn("text-xs font-semibold tabular-nums", accent)}>
                          Δ {sign}{k.delta.toLocaleString()} ({sign}{k.pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>

                <ProgressChartLegend
                  mode="period-cumulative"
                  metrics={defaultMetrics("period-cumulative", "ko").map((m) => ({
                    ...m,
                    color: "var(--muted-foreground)",
                  }))}
                  series={stages.map((s) => ({
                    key: s,
                    label: stageLabelShort[s],
                    color: SNAG_STAGE_COLORS[s].line,
                  }))}
                  hiddenMetrics={legend.hiddenMetrics}
                  hiddenSeries={legend.hiddenSeries}
                  onToggleMetric={legend.toggleMetric}
                  onToggleSeries={legend.toggleSeries}
                  onReset={legend.reset}
                  canReset={legend.canReset}
                  axes={{ left: "기간 (건)", right: "누적 (%)" }}
                  marker={todayLabel ? { label: "기준일", date: today } : undefined}
                />

                <ChartContainer config={cfg} className="h-[340px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis
                      yAxisId="cum"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      domain={[0, 100]}
                      ticks={[0, 20, 40, 60, 80, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis yAxisId="bar" tick={{ fontSize: 11 }} allowDecimals={false} domain={[0, "auto"]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && (
                      <ReferenceLine
                        yAxisId="cum"
                        x={todayLabel}
                        stroke="hsl(var(--destructive))"
                        strokeDasharray="4 2"
                        label={{ value: "Today", fontSize: 10, fill: "hsl(var(--destructive))" }}
                      />
                    )}
                    {stages.map((s) => (
                      <Bar
                        key={`plan-${s}`}
                        yAxisId="bar"
                        dataKey={`planInc_${s}`}
                        stackId="plan"
                        fill={SNAG_STAGE_COLORS[s].bar}
                        name={`${stageLabelShort[s]} Plan (${term}, 건) — 왼쪽 축`}
                        barSize={10}
                        hide={hidden.has(`planInc_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Bar
                        key={`actual-${s}`}
                        yAxisId="bar"
                        dataKey={`actualInc_${s}`}
                        stackId="actual"
                        fill={SNAG_STAGE_COLORS[s].line}
                        name={`${stageLabelShort[s]} Actual (${term}, 건) — 왼쪽 축`}
                        barSize={10}
                        hide={hidden.has(`actualInc_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Line
                        key={`cumPlan-${s}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumPlan_${s}`}
                        stroke={SNAG_STAGE_COLORS[s].line}
                        strokeDasharray="5 3"
                        strokeWidth={1.5}
                        dot={false}
                        name={`${stageLabelShort[s]} Plan (누적 %) — 오른쪽 축`}
                        hide={hidden.has(`cumPlan_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Line
                        key={`cumActual-${s}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumActual_${s}`}
                        stroke={SNAG_STAGE_COLORS[s].line}
                        strokeWidth={2.5}
                        dot={false}
                        name={`${stageLabelShort[s]} Actual (누적 %) — 오른쪽 축`}
                        connectNulls={false}
                        hide={hidden.has(`cumActual_${s}`)}
                      />
                    ))}
                  </ComposedChart>
                </ChartContainer>

                {/* Variance bars */}
                <ChartContainer config={varianceCfg} className="h-[120px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={["auto", "auto"]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && (
                      <ReferenceLine x={todayLabel} stroke="hsl(var(--destructive))" strokeDasharray="4 2" />
                    )}
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="variance" name="Δ Actual − Plan" barSize={8}>
                      {data.map((row, i) => {
                        const v = row.variance as number | null;
                        const fill =
                          v == null
                            ? "var(--color-muted)"
                            : v < 0
                              ? "var(--color-destructive)"
                              : "var(--color-emerald-600)";
                        return <Cell key={i} fill={fill} />;
                      })}
                    </Bar>
                  </ComposedChart>
                </ChartContainer>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}