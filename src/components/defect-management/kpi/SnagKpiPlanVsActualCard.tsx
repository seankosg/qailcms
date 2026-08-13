// SM KPI Analysis 전용 S-Curve 카드.
// 모양은 TM 의 TmPlanVsActualCard 를 복제하되, 계산 정본은 SM 의 buildSnagSCurve 다.
// (TM 컴포넌트/유틸은 import 하지 않는다.)
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  STAGE_LABELS,
  type Bucket,
  type CellRaw,
  type Stage,
} from "@/lib/defect-management/progress-utils";
import { buildSnagSCurve } from "@/lib/defect-management/scurve-utils";
import {
  clampWindow,
  incAxisMax,
  pickXTicks,
  signedDomain,
  trimFlatTail,
} from "@/lib/charts/scurve-view";
import { bucketTargetTerm } from "@/lib/charts/bucket-terms";

export type SnagCurveUnit = "cnt" | "pct";

const BUCKET_OPTIONS: Array<{ value: Bucket; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const UNIT_OPTIONS: Array<{ value: SnagCurveUnit; label: string }> = [
  { value: "cnt", label: "건수" },
  { value: "pct", label: "%" },
];

interface Props {
  cells: CellRaw[];
  buckets: string[];
  /** 단일 스테이지 */
  stage: Stage;
  today: string;
  asOfDate: string;
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
  unit: SnagCurveUnit;
  onUnitChange: (u: SnagCurveUnit) => void;
  filterSummary: Array<{ label: string; value: string }>;
  /** 차트 구간 이전까지의 누계(서버 totals, asOf = rangeStart-1) */
  baselinePlan: number;
  baselineActual: number;
  /** as-of 시점 정본 누계 — 머리말 P/A 는 곡선이 아니라 이 값을 쓴다 */
  planUpto: number;
  actualUpto: number;
  /** 선택 스테이지 모수 합계 — % 분모 */
  stageTotal: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** PDB 전용 — 카드 내 조작 UI(단위·Bucket 토글) 숨김 */
  controlsHidden?: boolean;
  /** 여러 차트를 나란히 놓을 때 공통 x 창(ISO). 주지 않으면 자기 모집단으로 잡는다. */
  windowStart?: string | null;
  windowEnd?: string | null;
  /** 절단 후 자기 창(ISO)을 밖으로 알린다 — 공통 창 합집합 계산용 */
  onWindowResolved?: (start: string, end: string) => void;
  /** 메인 S-Curve 차트 높이(px). 미지정 시 340px. */
  chartHeight?: number;
}

export function SnagKpiPlanVsActualCard({
  cells,
  buckets,
  stage,
  today,
  asOfDate,
  bucket,
  onBucketChange,
  unit,
  onUnitChange,
  filterSummary,
  baselinePlan,
  baselineActual,
  planUpto,
  actualUpto,
  stageTotal,
  open,
  onOpenChange,
  controlsHidden = false,
  windowStart,
  windowEnd,
  onWindowResolved,
  chartHeight = 340,
}: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const curve = useMemo(
    () => buildSnagSCurve({ cells, buckets, stages: [stage], today: asOfDate }),
    [cells, buckets, stage, asOfDate],
  );
  const ser = curve.series[stage];

  // 머리말은 정본(as-of 누계)을 그대로 쓴다 — 버킷이 as-of 를 걸쳐도 오차 0.
  const planNow = planUpto;
  const actualNow = actualUpto;
  const deltaNow = actualNow - planNow;

  const isPct = unit === "pct";
  // % 는 선택 스테이지의 모수(total)를 분모로 한다 — 막대 차트와 동일 정의.
  const denom = stageTotal > 0 ? stageTotal : 0;
  const conv = (v: number) => (isPct ? (denom > 0 ? (v / denom) * 100 : 0) : v);
  const r1 = (v: number) => Number(v.toFixed(1));

  const allData = curve.buckets.map((b, i) => ({
    bucket: b,
    bucketLabel: curve.bucketLabels[i],
    planInc: r1(conv(ser.dailyPlan[i])),
    actualInc: ser.dailyActual[i] == null ? null : r1(conv(ser.dailyActual[i] as number)),
    cumPlan: r1(conv(baselinePlan + ser.cumPlan[i])),
    cumActual:
      ser.cumActual[i] == null
        ? null
        : r1(conv(baselineActual + (ser.cumActual[i] as number))),
    // Δ 는 당일/금주/당월 목표 기준(해당 버킷 Actual − Plan) — ABD/SM Progress 카드와 동일 정의.
    variance:
      ser.dailyActual[i] == null
        ? null
        : r1(conv((ser.dailyActual[i] as number) - ser.dailyPlan[i])),
  }));

  // 보이는 창만 줄인다 — 누계·모수 계산에는 손대지 않는다.
  const view = useMemo(() => {
    const tail = trimFlatTail({
      planInc: allData.map((d) => d.planInc),
      actualInc: allData.map((d) => d.actualInc),
      todayIndex: curve.todayIndex,
    });
    const w = clampWindow(curve.buckets, 0, tail.end, windowStart, windowEnd);
    const own = {
      start: curve.buckets[0] ?? null,
      end: tail.end > 0 ? (curve.buckets[tail.end - 1] ?? null) : null,
    };
    return { rows: allData.slice(w.start, w.end), trimmed: tail.trimmed, own };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, windowStart, windowEnd, unit, baselinePlan, baselineActual, stageTotal]);
  const data = view.rows;
  const reportRef = useRef(onWindowResolved);
  reportRef.current = onWindowResolved;
  const ownStart = view.own.start;
  const ownEnd = view.own.end;
  useEffect(() => {
    if (ownStart && ownEnd) reportRef.current?.(ownStart, ownEnd);
  }, [ownStart, ownEnd]);

  const todayLabel = curve.todayIndex >= 0 ? (curve.bucketLabels[curve.todayIndex] ?? null) : null;

  const n = stageTotal;
  const unitSuffix = isPct ? "%" : "건";
  const term = bucketTargetTerm(bucket);
  const incLabel = isPct
    ? `Plan (${term}, %) — 오른쪽 축`
    : `Plan (${term}, 건) — 오른쪽 축`;
  const incActualLabel = isPct
    ? `Actual (${term}, %) — 오른쪽 축`
    : `Actual (${term}, 건) — 오른쪽 축`;
  const cumPlanLabel = isPct ? "Plan (cum %)" : "Plan (cum 건)";
  const cumActualLabel = isPct ? "Actual (cum %)" : "Actual (cum 건)";
  const varianceLabel = isPct
    ? `Δ Actual − Plan (${term}, %)`
    : `Δ Actual − Plan (${term}, 건)`;

  const cfg: ChartConfig = {
    planInc: { label: incLabel, color: "var(--muted-foreground)" },
    actualInc: { label: incActualLabel, color: "var(--primary)" },
    cumPlan: { label: cumPlanLabel, color: "var(--muted-foreground)" },
    cumActual: { label: cumActualLabel, color: "var(--destructive)" },
  };
  const varianceCfg: ChartConfig = {
    variance: { label: varianceLabel, color: "var(--destructive)" },
  };

  const hasData = data.length > 0 && cells.length > 0;
  const xTicks = useMemo(() => pickXTicks(data.map((d) => d.bucketLabel), 7), [data]);
  const incMax = useMemo(
    () => incAxisMax(data.flatMap((d) => [d.planInc, d.actualInc])),
    [data],
  );
  const varDomain = useMemo(() => signedDomain(data.map((d) => d.variance)), [data]);
  const Y_LEFT_WIDTH = 56;
  const Y_RIGHT_WIDTH = 44;
  const accent =
    deltaNow < 0
      ? "text-destructive"
      : deltaNow > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  const sign = deltaNow > 0 ? "+" : "";

  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left hover:opacity-80"
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Progress Status</CardTitle>
              </button>
            </CollapsibleTrigger>

            {controlsHidden ? null : (
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={unit}
                onValueChange={(v) => {
                  if (v === "pct" || v === "cnt") onUnitChange(v);
                }}
                className="gap-1"
              >
                {UNIT_OPTIONS.map((o) => (
                  <ToggleGroupItem
                    key={o.value}
                    value={o.value}
                    className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {o.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <ToggleGroup
                type="single"
                value={bucket}
                onValueChange={(v) => {
                  if (v === "day" || v === "week" || v === "month") onBucketChange(v);
                }}
                className="gap-1"
              >
                {BUCKET_OPTIONS.map((o) => (
                  <ToggleGroupItem
                    key={o.value}
                    value={o.value}
                    className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {o.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            )}
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3">
            {!hasData ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data in range.</p>
            ) : (
              <>
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
                  <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] tabular-nums text-foreground">
                    모수 {stageTotal.toLocaleString()}건
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-semibold text-primary">{STAGE_LABELS[stage]}</span>
                  <span className="text-muted-foreground">P</span>
                  <span className="tabular-nums">{conv(planNow).toFixed(1)}{unitSuffix}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">A</span>
                  <span className="tabular-nums">{conv(actualNow).toFixed(1)}{unitSuffix}</span>
                  <span className={cn("font-semibold tabular-nums", accent)}>
                    Δ {sign}{conv(deltaNow).toFixed(1)}{unitSuffix}
                  </span>
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
                      width={Y_LEFT_WIDTH}
                      tick={{ fontSize: 11 }}
                      domain={isPct ? [0, 100] : [0, "auto"]}
                      tickFormatter={(v) => (isPct ? `${v}%` : `${v}`)}
                    />
                    <YAxis
                      yAxisId="bar"
                      orientation="right"
                      width={Y_RIGHT_WIDTH}
                      tick={{ fontSize: 11 }}
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
                        x={todayLabel}
                        stroke="var(--destructive)"
                        strokeDasharray="4 2"
                        label={{ value: "As of", fontSize: 10, fill: "var(--destructive)" }}
                      />
                    )}
                    <Bar
                      yAxisId="bar"
                      dataKey="planInc"
                      name={incLabel}
                      fill="color-mix(in oklab, var(--muted-foreground) 22%, transparent)"
                      barSize={8}
                      hide={hidden.has("planInc")}
                    />
                    <Bar
                      yAxisId="bar"
                      dataKey="actualInc"
                      name={incActualLabel}
                      fill="color-mix(in oklab, var(--primary) 30%, transparent)"
                      barSize={8}
                      hide={hidden.has("actualInc")}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumPlan"
                      name={cumPlanLabel}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="6 4"
                      strokeWidth={2.5}
                      dot={false}
                      hide={hidden.has("cumPlan")}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumActual"
                      name={cumActualLabel}
                      stroke="var(--destructive)"
                      strokeWidth={3.5}
                      dot={false}
                      connectNulls={false}
                      hide={hidden.has("cumActual")}
                    />
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
                    <YAxis width={Y_LEFT_WIDTH} tick={{ fontSize: 11 }} domain={varDomain} />
                    {/* 위 차트의 우측 Y축과 같은 폭을 확보해 그림 영역을 일치시킨다. */}
                    <YAxis
                      yAxisId="spacer"
                      orientation="right"
                      width={Y_RIGHT_WIDTH}
                      tick={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && (
                      <ReferenceLine
                        x={todayLabel}
                        stroke="var(--destructive)"
                        strokeDasharray="4 2"
                      />
                    )}
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Bar dataKey="variance" name={varianceLabel} barSize={8}>
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