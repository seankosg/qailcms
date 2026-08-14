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
import { incAxisMax, pickXTicks, signedDomain, trimFlatTail } from "@/lib/charts/scurve-view";
import {
  buildSplSCurve,
  type SplBucket,
  type SplPlanMode,
  type SplSeriesGroup,
} from "@/lib/spl/scurve";
import type { SplRow } from "@/lib/spl/rows.functions";
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

const TERM: Record<SplBucket, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

/**
 * SPL Progress Status — 계획 대비 실적(다른 모듈의 Plan vs Actual 카드와 동일 구성).
 * 막대 = 버킷 증분(좌축, 건수), 곡선 = 누적 진도율(우축, %), 하단 = Δ(실적−계획).
 */
export function SplPlanVsActualCard({
  rows,
  groups,
  bucket,
  planMode,
  asOf,
  rangeDays,
  open,
  onOpenChange,
  filterSummary = [],
}: {
  rows: SplRow[];
  groups: SplSeriesGroup[];
  bucket: SplBucket;
  planMode: SplPlanMode;
  asOf: string;
  rangeDays: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filterSummary?: Array<{ label: string; value: string }>;
}) {
  const scurve = useMemo(
    () => buildSplSCurve({ rows, groups, bucket, planMode, asOf, rangeDays }),
    [rows, groups, bucket, planMode, asOf, rangeDays],
  );

  const legend = useProgressLegend({
    metricKeys: METRIC_KEYS,
    seriesKeys: groups.map((g) => g.key),
    dataKey: (m, s) => `${METRIC_PREFIX[m]}_${s}`,
  });
  const hidden = legend.hidden;

  const byKey = new Map(scurve.series.map((s) => [s.key, s]));

  const allData = scurve.bucketLabels.map((label, i) => {
    const row: Record<string, unknown> = { bucketLabel: label };
    let varSum: number | null = 0;
    let anyNull = false;
    let planIncSum = 0;
    let actualIncSum = 0;
    for (const g of groups) {
      const ser = byKey.get(g.key);
      if (!ser) continue;
      row[`planInc_${g.key}`] = ser.dailyPlan[i];
      row[`actualInc_${g.key}`] = ser.dailyActual[i];
      const toPct = (v: number | null) =>
        v == null ? null : ser.denom > 0 ? Math.round((v / ser.denom) * 1000) / 10 : null;
      row[`cumPlan_${g.key}`] = toPct(ser.cumPlan[i]);
      row[`cumActual_${g.key}`] = toPct(ser.cumActual[i]);
      const a = ser.dailyActual[i];
      const p = ser.dailyPlan[i];
      planIncSum += p ?? 0;
      actualIncSum += a ?? 0;
      if (a == null) anyNull = true;
      else if (varSum != null) varSum += a - p;
    }
    row.variance = anyNull ? null : varSum;
    row.__planIncSum = planIncSum;
    row.__actualIncSum = actualIncSum;
    return row;
  });

  const view = useMemo(() => {
    const tail = trimFlatTail({
      planInc: allData.map((d) => d.__planIncSum as number),
      actualInc: allData.map((d) => d.__actualIncSum as number),
      todayIndex: scurve.todayIndex,
    });
    return { rows: allData.slice(0, tail.end), trimmed: tail.trimmed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scurve, groups]);
  const data = view.rows;

  const xTicks = useMemo(() => pickXTicks(data.map((d) => String(d.bucketLabel)), 7), [data]);
  const incMax = useMemo(
    () => incAxisMax(data.flatMap((d) => [d.__planIncSum as number, d.__actualIncSum as number]), 1.15),
    [data],
  );
  const varDomain = useMemo(() => signedDomain(data.map((d) => d.variance as number | null)), [data]);
  const todayLabel = scurve.todayIndex >= 0 ? scurve.bucketLabels[scurve.todayIndex] ?? null : null;

  const cfg: ChartConfig = Object.fromEntries(
    groups.flatMap((g) => [
      [`planInc_${g.key}`, { label: `${g.label} Plan (${TERM[bucket]})`, color: g.color }],
      [`actualInc_${g.key}`, { label: `${g.label} Actual (${TERM[bucket]})`, color: g.color }],
      [`cumPlan_${g.key}`, { label: `${g.label} Plan (Cumulative %)`, color: g.color }],
      [`cumActual_${g.key}`, { label: `${g.label} Actual (Cumulative %)`, color: g.color }],
    ]),
  ) as ChartConfig;

  const varianceCfg: ChartConfig = { variance: { label: "Δ Actual − Plan", color: "var(--destructive)" } };
  const hasData = data.length > 0 && groups.length > 0;

  const idxForKpi = scurve.todayIndex >= 0 ? scurve.todayIndex : scurve.buckets.length - 1;
  const kpis = groups.map((g) => {
    const ser = byKey.get(g.key);
    const plan = ser?.cumPlan[idxForKpi] ?? 0;
    const actual = (ser?.cumActual[idxForKpi] ?? 0) as number;
    const delta = actual - plan;
    return { key: g.key, label: g.label, color: g.color, plan, actual, delta, pct: plan > 0 ? (delta / plan) * 100 : 0 };
  });

  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center gap-2 text-left hover:opacity-80" aria-expanded={open}>
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Progress Status</CardTitle>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {!hasData ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data to display.</p>
            ) : (
              <>
                {filterSummary.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {filterSummary.map((f) => (
                      <span
                        key={f.label}
                        className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <span className="font-semibold uppercase tracking-wide">{f.label}</span>{" "}
                        <span className="text-foreground">{f.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  {kpis.map((k, i) => {
                    const accent =
                      k.delta < 0
                        ? "text-destructive"
                        : k.delta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground";
                    const sign = k.delta > 0 ? "+" : "";
                    return (
                      <span key={k.key} className="inline-flex items-center gap-1">
                        <span className="font-semibold" style={{ color: k.color }}>{k.label}</span>
                        <span className="text-muted-foreground">P</span>
                        <span className="tabular-nums">{k.plan.toLocaleString()}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">A</span>
                        <span className="tabular-nums">{k.actual.toLocaleString()}</span>
                        <span className={cn("font-semibold tabular-nums", accent)}>
                          Δ {sign}{k.delta.toLocaleString()} ({sign}{k.pct.toFixed(1)}%)
                        </span>
                        {i !== kpis.length - 1 && <span className="mx-1 text-muted-foreground">|</span>}
                      </span>
                    );
                  })}
                  {view.trimmed > 0 && (
                    <span className="text-[11px] text-muted-foreground">{view.trimmed} empty trailing buckets omitted</span>
                  )}
                </div>

                <ProgressChartLegend
                  mode="period-cumulative"
                  lang="en"
                  metrics={defaultMetrics("period-cumulative", "en").map((m) => ({
                    ...m,
                    color: "var(--muted-foreground)",
                  }))}
                  series={groups.map((g) => ({ key: g.key, label: g.label, color: g.color }))}
                  hiddenMetrics={legend.hiddenMetrics}
                  hiddenSeries={legend.hiddenSeries}
                  onToggleMetric={legend.toggleMetric}
                  onToggleSeries={legend.toggleSeries}
                  onReset={legend.reset}
                  canReset={legend.canReset}
                  axes={{ left: "Period (No.)", right: "Cumulative (%)" }}
                  marker={todayLabel ? { label: "As-of", date: asOf } : undefined}
                />

                <ChartContainer config={cfg} className="w-full" style={{ height: 380 }}>
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucketLabel"
                      tick={{ fontSize: 10 }}
                      ticks={xTicks}
                      interval={0}
                      minTickGap={0}
                      angle={-30}
                      textAnchor="end"
                      height={46}
                    />
                    <YAxis
                      yAxisId="cum"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      domain={[0, 100]}
                      ticks={[0, 20, 40, 60, 80, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis yAxisId="bar" tick={{ fontSize: 11 }} allowDecimals={false} domain={[0, incMax]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && (
                      <ReferenceLine
                        yAxisId="cum"
                        x={todayLabel}
                        stroke="var(--destructive)"
                        strokeDasharray="4 2"
                        label={{ value: "As-of", fontSize: 10, fill: "var(--destructive)" }}
                      />
                    )}
                    {groups.map((g) => (
                      <Bar
                        key={`plan-${g.key}`}
                        yAxisId="bar"
                        dataKey={`planInc_${g.key}`}
                        stackId="plan"
                        fill={`color-mix(in oklab, ${g.color} 45%, transparent)`}
                        name={`${g.label} Plan (${TERM[bucket]}, No.) — left axis`}
                        barSize={8}
                        hide={hidden.has(`planInc_${g.key}`)}
                      />
                    ))}
                    {groups.map((g) => (
                      <Bar
                        key={`actual-${g.key}`}
                        yAxisId="bar"
                        dataKey={`actualInc_${g.key}`}
                        stackId="actual"
                        fill={`color-mix(in oklab, ${g.color} 80%, transparent)`}
                        name={`${g.label} Actual (${TERM[bucket]}, No.) — left axis`}
                        barSize={8}
                        hide={hidden.has(`actualInc_${g.key}`)}
                      />
                    ))}
                    {groups.map((g) => (
                      <Line
                        key={`cumPlan-${g.key}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumPlan_${g.key}`}
                        stroke={g.color}
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        dot={false}
                        name={`${g.label} Plan (Cumulative %) — right axis`}
                        hide={hidden.has(`cumPlan_${g.key}`)}
                      />
                    ))}
                    {groups.map((g) => (
                      <Line
                        key={`cumActual-${g.key}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumActual_${g.key}`}
                        stroke={g.color}
                        strokeWidth={3}
                        dot={false}
                        name={`${g.label} Actual (Cumulative %) — right axis`}
                        connectNulls={false}
                        hide={hidden.has(`cumActual_${g.key}`)}
                      />
                    ))}
                  </ComposedChart>
                </ChartContainer>

                <VarianceLegend
                  lang="en"
                  aheadColor="var(--success)"
                  behindColor="var(--destructive)"
                  unitNote="Variance (No.)"
                />
                <ChartContainer config={varianceCfg} className="h-[120px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucketLabel"
                      tick={{ fontSize: 10 }}
                      ticks={xTicks}
                      interval={0}
                      minTickGap={0}
                      angle={-30}
                      textAnchor="end"
                      height={46}
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={varDomain} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && <ReferenceLine x={todayLabel} stroke="var(--destructive)" strokeDasharray="4 2" />}
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Bar dataKey="variance" name="Δ Actual − Plan" barSize={8}>
                      {data.map((row, i) => {
                        const v = row.variance as number | null;
                        return (
                          <Cell key={i} fill={v == null ? "transparent" : v < 0 ? "var(--destructive)" : "var(--success)"} />
                        );
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