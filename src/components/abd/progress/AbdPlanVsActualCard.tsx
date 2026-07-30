import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
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
} from "@/lib/abd/progress-utils";
import {
  buildAbdSCurve,
  ABD_STAGE_COLORS,
  PLAN_DASH,
  type SCurveBaselines,
  type SCurveCum,
} from "@/lib/abd/scurve-utils";

export interface AbdPlanVsActualCardProps {
  /** 전 라운드 통합 cells (메인 매트릭스 쿼리 재사용) */
  cells: CellRaw[];
  buckets: string[];
  stages: Stage[];
  today: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** rangeStart-1 시점의 누계 오프셋 (스테이지별) */
  baselines?: SCurveBaselines;
  /** 서버 정본 누적(문서 distinct). 종점 = 행 totals */
  cum?: SCurveCum;
}

export function AbdPlanVsActualCard({
  cells,
  buckets,
  stages,
  today,
  open,
  onOpenChange,
  baselines,
  cum,
}: AbdPlanVsActualCardProps) {
  const scurve = useMemo(
    () => buildAbdSCurve({ cells, buckets, stages, today, baselines, cum }),
    [cells, buckets, stages, today, baselines, cum],
  );

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const seriesByStage = new Map<Stage, (typeof scurve.series)[number]>();
  for (const s of scurve.series) seriesByStage.set(s.stage, s);

  const data = scurve.bucketLabels.map((label, i) => {
    const row: Record<string, unknown> = {
      bucket: scurve.buckets[i],
      bucketLabel: label,
    };
    let varSum: number | null = 0;
    let anyNull = false;
    for (const st of stages) {
      const ser = seriesByStage.get(st);
      if (!ser) continue;
      row[`planInc_${st}`] = ser.dailyPlan[i];
      row[`actualInc_${st}`] = ser.dailyActual[i];
      row[`cumPlan_${st}`] = ser.cumPlan[i];
      row[`cumActual_${st}`] = ser.cumActual[i];
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
      [`planInc_${s}`, { label: `${STAGE_LABELS[s]} Plan (daily)`, color: ABD_STAGE_COLORS[s].bar }],
      [`actualInc_${s}`, { label: `${STAGE_LABELS[s]} Actual (daily)`, color: ABD_STAGE_COLORS[s].line }],
      [`cumPlan_${s}`, { label: `${STAGE_LABELS[s]} Plan (cum)`, color: ABD_STAGE_COLORS[s].line }],
      [`cumActual_${s}`, { label: `${STAGE_LABELS[s]} Actual (cum)`, color: ABD_STAGE_COLORS[s].line }],
    ]),
  ) as ChartConfig;

  const varianceCfg: ChartConfig = {
    variance: { label: "Δ Actual − Plan", color: "hsl(var(--destructive))" },
  };

  const hasData = buckets.length > 0 && stages.length > 0;

  // KPI: 오늘 시점, 스테이지별 P/A/Δ (compact)
  const idxForKpi = scurve.todayIndex >= 0 ? scurve.todayIndex : buckets.length - 1;
  const kpis = stages.map((s) => {
    const ser = seriesByStage.get(s);
    const plan = ser?.cumPlan[idxForKpi] ?? 0;
    const actual = (ser?.cumActual[idxForKpi] ?? 0) as number;
    const delta = actual - plan;
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
                {ALL_STAGES.filter((s) => stages.includes(s)).map((s) => STAGE_LABELS[s]).join(" / ")}
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
                    const accent =
                      k.delta < 0
                        ? "text-destructive"
                        : k.delta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground";
                    const sign = k.delta > 0 ? "+" : "";
                    return (
                      <div
                        key={k.stage}
                        className="flex flex-col gap-0.5 rounded border-l-4 px-3 py-1"
                        style={{ borderLeftColor: ABD_STAGE_COLORS[k.stage].line }}
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {STAGE_LABELS[k.stage]}
                        </span>
                        <span className="text-xs tabular-nums">
                          <span className="text-muted-foreground">P</span> {k.plan.toLocaleString()}{" "}
                          · <span className="text-muted-foreground">A</span>{" "}
                          {k.actual.toLocaleString()}
                        </span>
                        <span className={cn("text-xs font-semibold tabular-nums", accent)}>
                          Δ {sign}{k.delta.toLocaleString()} ({sign}{k.pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>

                <ChartContainer config={cfg} className="h-[360px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis yAxisId="cum" tick={{ fontSize: 11 }} allowDecimals={false} domain={["auto", "auto"]} />
                    <YAxis yAxisId="bar" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} domain={["auto", "auto"]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      onClick={(o) => {
                        const dk = (o as { dataKey?: string })?.dataKey;
                        if (dk) toggle(String(dk));
                      }}
                    />
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
                        fill={ABD_STAGE_COLORS[s].bar}
                        name={`${STAGE_LABELS[s]} Plan (daily)`}
                        barSize={8}
                        hide={hidden.has(`planInc_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Bar
                        key={`actual-${s}`}
                        yAxisId="bar"
                        dataKey={`actualInc_${s}`}
                        stackId="actual"
                        fill={ABD_STAGE_COLORS[s].line}
                        name={`${STAGE_LABELS[s]} Actual (daily)`}
                        barSize={8}
                        hide={hidden.has(`actualInc_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Line
                        key={`cumPlan-${s}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumPlan_${s}`}
                        stroke={ABD_STAGE_COLORS[s].line}
                        strokeDasharray={PLAN_DASH}
                        strokeWidth={1.5}
                        dot={false}
                        name={`${STAGE_LABELS[s]} Plan (cum)`}
                        hide={hidden.has(`cumPlan_${s}`)}
                      />
                    ))}
                    {stages.map((s) => (
                      <Line
                        key={`cumActual-${s}`}
                        yAxisId="cum"
                        type="monotone"
                        dataKey={`cumActual_${s}`}
                        stroke={ABD_STAGE_COLORS[s].line}
                        strokeWidth={2.5}
                        dot={false}
                        name={`${STAGE_LABELS[s]} Actual (cum)`}
                        connectNulls={false}
                        hide={hidden.has(`cumActual_${s}`)}
                      />
                    ))}
                  </ComposedChart>
                </ChartContainer>

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
