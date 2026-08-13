import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  clampWindow,
  incAxisMax,
  pickXTicks,
  signedDomain,
  trimFlatTail,
} from "@/lib/charts/scurve-view";

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
  /** 스테이지별 문서 모수(분모) — 누적곡선을 진도율 %로 그린다 */
  denomByStage?: Partial<Record<Stage, number>>;
  /** 여러 차트를 나란히 놓을 때 공통 x 창(ISO). 주지 않으면 자기 모집단으로 잡는다. */
  windowStart?: string | null;
  windowEnd?: string | null;
  /** 절단 후 자기 창(ISO)을 밖으로 알린다 — 공통 창 합집합 계산용 */
  onWindowResolved?: (start: string, end: string) => void;
  /** 메인 S-Curve 차트 높이(px). 미지정 시 360px. */
  chartHeight?: number;
  /** 상단 필터 현황(헤더 표시용) */
  filterSummary?: Array<{ label: string; value: string }>;
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
  denomByStage,
  windowStart,
  windowEnd,
  onWindowResolved,
  chartHeight = 360,
  filterSummary = [],
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

  const allData = scurve.bucketLabels.map((label, i) => {
    const row: Record<string, unknown> = {
      bucket: scurve.buckets[i],
      bucketLabel: label,
    };
    let varSum: number | null = 0;
    let anyNull = false;
    let planIncSum = 0;
    let actualIncSum = 0;
    for (const st of stages) {
      const ser = seriesByStage.get(st);
      if (!ser) continue;
      row[`planInc_${st}`] = ser.dailyPlan[i];
      row[`actualInc_${st}`] = ser.dailyActual[i];
      const denom = denomByStage?.[st] ?? 0;
      const toPct = (v: number | null) =>
        v == null ? null : denom > 0 ? Math.round((v / denom) * 1000) / 10 : null;
      row[`cumPlan_${st}`] = toPct(ser.cumPlan[i]);
      row[`cumActual_${st}`] = toPct(ser.cumActual[i] as number | null);
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

  // 보이는 창만 줄인다 — 누계·모수 계산은 건드리지 않는다.
  const view = useMemo(() => {
    const tail = trimFlatTail({
      planInc: allData.map((d) => d.__planIncSum as number),
      actualInc: allData.map((d) => d.__actualIncSum as number),
      todayIndex: scurve.todayIndex,
    });
    const w = clampWindow(scurve.buckets, 0, tail.end, windowStart, windowEnd);
    const own = {
      start: scurve.buckets[0] ?? null,
      end: tail.end > 0 ? (scurve.buckets[tail.end - 1] ?? null) : null,
    };
    return { rows: allData.slice(w.start, w.end), trimmed: tail.trimmed, own };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scurve, stages, windowStart, windowEnd]);
  const data = view.rows;
  const reportRef = useRef(onWindowResolved);
  reportRef.current = onWindowResolved;
  const ownStart = view.own.start;
  const ownEnd = view.own.end;
  useEffect(() => {
    if (ownStart && ownEnd) reportRef.current?.(ownStart, ownEnd);
  }, [ownStart, ownEnd]);
  const xTicks = useMemo(
    () => pickXTicks(data.map((d) => String(d.bucketLabel)), 7),
    [data],
  );
  const incMax = useMemo(
    () =>
      incAxisMax(
        data.flatMap((d) => [d.__planIncSum as number, d.__actualIncSum as number]),
      ),
    [data],
  );
  const varDomain = useMemo(
    () => signedDomain(data.map((d) => d.variance as number | null)),
    [data],
  );

  const todayLabel =
    scurve.todayIndex >= 0 ? scurve.bucketLabels[scurve.todayIndex] ?? null : null;

  const cfg: ChartConfig = Object.fromEntries(
    stages.flatMap((s) => [
      [`planInc_${s}`, { label: `${STAGE_LABELS[s]} Plan (daily)`, color: ABD_STAGE_COLORS[s].bar }],
      [`actualInc_${s}`, { label: `${STAGE_LABELS[s]} Actual (daily)`, color: ABD_STAGE_COLORS[s].line }],
      [`cumPlan_${s}`, { label: `${STAGE_LABELS[s]} Plan (누적 %)`, color: ABD_STAGE_COLORS[s].line }],
      [`cumActual_${s}`, { label: `${STAGE_LABELS[s]} Actual (누적 %)`, color: ABD_STAGE_COLORS[s].line }],
    ]),
  ) as ChartConfig;

  const varianceCfg: ChartConfig = {
    variance: { label: "Δ Actual − Plan", color: "hsl(var(--destructive))" },
  };

  const hasData = data.length > 0 && stages.length > 0;

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
              className="flex w-full items-center gap-2 text-left hover:opacity-80"
              aria-expanded={open}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Progress Status</CardTitle>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {!hasData ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data in range.</p>
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
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  {kpis.map((k, i) => {
                    const accent =
                      k.delta < 0
                        ? "text-destructive"
                        : k.delta > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground";
                    const sign = k.delta > 0 ? "+" : "";
                    const isLast = i === kpis.length - 1;
                    return (
                      <span key={k.stage} className="inline-flex items-center gap-1">
                        <span
                          className="font-semibold"
                          style={{ color: ABD_STAGE_COLORS[k.stage].line }}
                        >
                          {STAGE_LABELS[k.stage]}
                        </span>
                        <span className="text-muted-foreground">P</span>
                        <span className="tabular-nums">{k.plan.toLocaleString()}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">A</span>
                        <span className="tabular-nums">{k.actual.toLocaleString()}</span>
                        <span className={cn("font-semibold tabular-nums", accent)}>
                          Δ {sign}{k.delta.toLocaleString()} ({sign}{k.pct.toFixed(1)}%)
                        </span>
                        {!isLast && (
                          <span className="mx-1 text-muted-foreground">|</span>
                        )}
                      </span>
                    );
                  })}
                  {view.trimmed > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      · 이후 {view.trimmed}개 구간 계획 없음
                    </span>
                  )}
                </div>

                <ChartContainer config={cfg} className="w-full" style={{ height: chartHeight }}>
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
                    <YAxis
                      yAxisId="bar"
                      tick={{ fontSize: 11 }}
                      allowDecimals={false}
                      domain={[0, incMax]}
                    />
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
                        fill={`color-mix(in oklab, ${ABD_STAGE_COLORS[s].bar} 45%, transparent)`}
                        name={`${STAGE_LABELS[s]} Plan (increment) — 오른쪽 축`}
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
                        fill={`color-mix(in oklab, ${ABD_STAGE_COLORS[s].line} 35%, transparent)`}
                        name={`${STAGE_LABELS[s]} Actual (increment) — 오른쪽 축`}
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
                        strokeWidth={2.5}
                        dot={false}
                        name={`${STAGE_LABELS[s]} Plan (누적 %)`}
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
                        strokeWidth={3.5}
                        dot={false}
                        name={`${STAGE_LABELS[s]} Actual (누적 %)`}
                        connectNulls={false}
                        hide={hidden.has(`cumActual_${s}`)}
                      />
                    ))}
                  </ComposedChart>
                </ChartContainer>

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
                    {todayLabel && (
                      <ReferenceLine x={todayLabel} stroke="hsl(var(--destructive))" strokeDasharray="4 2" />
                    )}
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="variance" name="Δ Actual − Plan" barSize={8}>
                      {data.map((row, i) => {
                        const v = row.variance as number | null;
                        const fill =
                          v == null
                            ? "transparent"
                            : v < 0
                              ? "var(--destructive)"
                              : "var(--success)";
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
