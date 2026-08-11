import { useEffect, useMemo, useState } from "react";
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
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import type { OwnerDim } from "@/lib/task-management/delay-utils";
import { buildTmSCurve, type SCurveBucket } from "@/lib/task-management/scurve-utils";
import { useTaskProgressSnapshot, snapshotKey } from "@/hooks/useTaskProgressSnapshot";

type CurveUnit = "pct" | "tasks";

const BUCKET_OPTIONS: Array<{ value: SCurveBucket; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const UNIT_OPTIONS: Array<{ value: CurveUnit; label: string }> = [
  { value: "pct", label: "%" },
  { value: "tasks", label: "Tasks" },
];

const DIM_LABEL: Record<OwnerDim, string> = {
  team: "Team",
  hdec_pic_name: "PIC",
  hdec_eng_name: "Engineer",
};

interface Props {
  items: TaskItem[];
  asOfDate: string;
  /** 차트 시작일(ISO) */
  startFrom?: string | null;
  dim: OwnerDim;
  /** 상단 필터 현황(헤더 표시용) */
  filterSummary: Array<{ label: string; value: string }>;
  bucket: SCurveBucket;
  onBucketChange: (b: SCurveBucket) => void;
  /** PDB 전용 — 카드 내 조작 UI(단위·Bucket 토글) 숨김 */
  controlsHidden?: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TmPlanVsActualCard({
  items,
  asOfDate,
  startFrom,
  dim,
  filterSummary,
  bucket,
  onBucketChange,
  controlsHidden = false,
  open,
  onOpenChange,
}: Props) {
  const snap = useTaskProgressSnapshot();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [unit, setUnit] = useState<CurveUnit>("pct");
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 대상 범위는 상단 필터가 이미 적용된 items 그대로 사용한다(카드 내 담당자 필터 폐기).
  const scoped = items;

  const curve = useMemo(
    () =>
      buildTmSCurve({
        items: scoped,
        asOf: asOfDate,
        bucket,
        startFrom: startFrom ?? null,
        pointsOf: (it) =>
          snap.ready ? snap.pointsOf(snapshotKey(it.discipline, it.task_no)) : null,
      }),
    // snap.ready 를 의존성에 포함해 스냅샷 로드 후 재계산한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, asOfDate, bucket, startFrom, snap.ready],
  );

  const n = curve.taskCount;
  const isTasks = unit === "tasks";
  // Tasks 환산 물량 = Σ 진척률 = (pct / 100) × n
  const conv = (v: number) => (isTasks ? (v / 100) * n : v);
  const r1 = (v: number) => Number(v.toFixed(1));

  const data = curve.buckets.map((b, i) => ({
    bucket: b,
    bucketLabel: curve.bucketLabels[i],
    planInc: r1(conv(curve.dailyPlan[i])),
    actualInc: curve.dailyActual[i] == null ? null : r1(conv(curve.dailyActual[i] as number)),
    cumPlan: r1(conv(curve.cumPlan[i])),
    cumActual: curve.cumActual[i] == null ? null : r1(conv(curve.cumActual[i] as number)),
    variance:
      curve.cumActual[i] == null
        ? null
        : r1(conv((curve.cumActual[i] as number) - curve.cumPlan[i])),
  }));

  const todayLabel = curve.todayIndex >= 0 ? (curve.bucketLabels[curve.todayIndex] ?? null) : null;

  const idxForKpi = curve.todayIndex >= 0 ? curve.todayIndex : curve.buckets.length - 1;
  const planNow = idxForKpi >= 0 ? (curve.cumPlan[idxForKpi] ?? 0) : 0;
  // 실적은 버킷 종료일이 기준일보다 뒤면 null 이다(주·월 단위에서 흔함).
  // 그래서 null 이 아닌 마지막 인덱스의 누계를 쓴다. 계획(P)은 지금대로 둔다.
  let lastActualIdx = -1;
  for (let i = curve.cumActual.length - 1; i >= 0; i--) {
    if (curve.cumActual[i] != null) {
      lastActualIdx = i;
      break;
    }
  }
  const actualNow = lastActualIdx >= 0 ? (curve.cumActual[lastActualIdx] as number) : 0;
  const deltaNow = actualNow - planNow;

  const unitSuffix = isTasks ? " tasks" : "%";
  const incLabel = isTasks ? "Plan (increment, tasks)" : "Plan (increment, pp)";
  const incActualLabel = isTasks ? "Actual (increment, tasks)" : "Actual (increment, pp)";
  const cumPlanLabel = isTasks ? "Plan (cum tasks)" : "Plan (cum %)";
  const cumActualLabel = isTasks ? "Actual (cum tasks)" : "Actual (cum %)";
  const varianceLabel = isTasks ? "Δ Actual − Plan (tasks)" : "Δ Actual − Plan (pp)";

  const cfg: ChartConfig = {
    planInc: { label: incLabel, color: "var(--muted-foreground)" },
    actualInc: { label: incActualLabel, color: "var(--primary)" },
    cumPlan: { label: cumPlanLabel, color: "var(--muted-foreground)" },
    cumActual: { label: cumActualLabel, color: "var(--destructive)" },
  };
  const varianceCfg: ChartConfig = {
    variance: { label: varianceLabel, color: "var(--destructive)" },
  };

  const hasData = curve.buckets.length > 0 && scoped.length > 0;
  // 위·아래 차트의 x축 눈금을 동일하게 맞춘다(그림 영역 폭 + ticks 배열 공유).
  const xTicks = useMemo(() => {
    const labels = curve.bucketLabels;
    if (labels.length <= 12) return labels;
    const step = Math.ceil(labels.length / 12);
    return labels.filter((_, i) => i % step === 0);
  }, [curve.bucketLabels]);
  const Y_LEFT_WIDTH = 56;
  const Y_RIGHT_WIDTH = 44;
  const accent =
    deltaNow < 0
      ? "text-destructive"
      : deltaNow > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  const sign = deltaNow > 0 ? "+" : "";
  const appliedLabel = `${filterSummary
    .map((f) => `${f.label}: ${f.value}`)
    .join(" · ")} · n = ${n.toLocaleString()} tasks`;

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
                <CardTitle className="text-base">Plan vs Actual — S-Curve</CardTitle>
                {controlsHidden ? null : (
                <div className="flex flex-wrap items-center gap-1">
                  {filterSummary.map((f) => (
                    <span
                      key={f.label}
                      className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      <span className="font-semibold uppercase tracking-wide">{f.label}</span>{" "}
                      <span className="text-foreground">{f.value}</span>
                    </span>
                  ))}
                  <span className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs tabular-nums text-foreground">
                    n = {n.toLocaleString()} tasks
                  </span>
                </div>
                )}
              </button>
            </CollapsibleTrigger>

            {controlsHidden ? null : (
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={unit}
                onValueChange={(v) => {
                  if (v === "pct" || v === "tasks") setUnit(v);
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
                <div className="flex flex-wrap items-stretch gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <div className="flex flex-col gap-0.5 rounded border-l-4 border-l-primary px-3 py-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {appliedLabel} · as of {asOfDate}
                    </span>
                    <span className="text-xs tabular-nums">
                      <span className="text-muted-foreground">P</span> {conv(planNow).toFixed(1)}
                      {unitSuffix} · <span className="text-muted-foreground">A</span>{" "}
                      {conv(actualNow).toFixed(1)}
                      {unitSuffix}
                    </span>
                    <span className={cn("text-xs font-semibold tabular-nums", accent)}>
                      Δ {sign}
                      {conv(deltaNow).toFixed(1)}
                      {isTasks ? " tasks" : "pp"}
                    </span>
                  </div>
                  <div className="flex flex-col justify-center px-3 py-1 text-[10px] leading-relaxed text-muted-foreground">
                    <span>Solid = actual · Dashed = plan</span>
                    <span>
                      {isTasks
                        ? "Tasks = Σ progress (0.4 진행 = 0.4건)"
                        : "% = 대상 과업 진척률 단순 평균"}
                    </span>
                  </div>
                  {curve.excludedCount > 0 && (
                    <div className="flex items-center rounded border border-destructive/40 bg-destructive/10 px-3 py-1 text-[11px] font-semibold text-destructive">
                      실적 시작 기준일 없음 — {curve.excludedCount.toLocaleString()}건 실적 곡선
                      제외
                    </div>
                  )}
                </div>

                <ChartContainer config={cfg} className="h-[340px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucketLabel"
                      tick={{ fontSize: 10 }}
                      ticks={xTicks}
                      interval={0}
                      minTickGap={0}
                    />
                    <YAxis
                      width={Y_LEFT_WIDTH}
                      tick={{ fontSize: 11 }}
                      domain={[0, "auto"]}
                      tickFormatter={(v) => (isTasks ? `${v}` : `${v}%`)}
                    />
                    <YAxis
                      yAxisId="bar"
                      orientation="right"
                      width={Y_RIGHT_WIDTH}
                      tick={{ fontSize: 11 }}
                      domain={["auto", "auto"]}
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
                      fill="color-mix(in oklab, var(--muted-foreground) 35%, transparent)"
                      barSize={8}
                      hide={hidden.has("planInc")}
                    />
                    <Bar
                      yAxisId="bar"
                      dataKey="actualInc"
                      name={incActualLabel}
                      fill="var(--primary)"
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
                    />
                    <YAxis
                      width={Y_LEFT_WIDTH}
                      tick={{ fontSize: 11 }}
                      domain={["auto", "auto"]}
                    />
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
                        // 값이 없는 구간(미래)은 그리지 않는다.
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
