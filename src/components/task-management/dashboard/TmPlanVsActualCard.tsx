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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const ALL_KEY = "__all__";

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
  dim: OwnerDim;
  /** 선택 대상 키. 빈 문자열이면 모집단 전체 롤업 */
  ownerKey: string;
  onOwnerKeyChange: (key: string) => void;
  bucket: SCurveBucket;
  onBucketChange: (b: SCurveBucket) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TmPlanVsActualCard({
  items,
  asOfDate,
  dim,
  ownerKey,
  onOwnerKeyChange,
  bucket,
  onBucketChange,
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

  const NONE = "(미지정)";
  const ownerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      const raw = (it as any)[dim];
      s.add(raw ? String(raw).trim() || NONE : NONE);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [items, dim]);

  // 상단 필터 변경으로 선택 대상이 목록에서 사라지면 자동으로 전체로 되돌린다.
  useEffect(() => {
    if (ownerKey && !ownerOptions.includes(ownerKey)) onOwnerKeyChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOptions, ownerKey]);

  const scoped = useMemo(() => {
    if (!ownerKey) return items;
    return items.filter((it) => {
      const raw = (it as any)[dim];
      const key = raw ? String(raw).trim() || NONE : NONE;
      return key === ownerKey;
    });
  }, [items, dim, ownerKey]);

  const curve = useMemo(
    () =>
      buildTmSCurve({
        items: scoped,
        asOf: asOfDate,
        bucket,
        pointsOf: (it) =>
          snap.ready ? snap.pointsOf(snapshotKey(it.discipline, it.task_no)) : null,
      }),
    // snap.ready 를 의존성에 포함해 스냅샷 로드 후 재계산한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, asOfDate, bucket, snap.ready],
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
    actualInc:
      curve.dailyActual[i] == null ? null : r1(conv(curve.dailyActual[i] as number)),
    cumPlan: r1(conv(curve.cumPlan[i])),
    cumActual: curve.cumActual[i] == null ? null : r1(conv(curve.cumActual[i] as number)),
    variance:
      curve.cumActual[i] == null
        ? null
        : r1(conv((curve.cumActual[i] as number) - curve.cumPlan[i])),
  }));

  const todayLabel =
    curve.todayIndex >= 0 ? curve.bucketLabels[curve.todayIndex] ?? null : null;

  const idxForKpi = curve.todayIndex >= 0 ? curve.todayIndex : curve.buckets.length - 1;
  const planNow = idxForKpi >= 0 ? curve.cumPlan[idxForKpi] ?? 0 : 0;
  const actualNow = idxForKpi >= 0 ? (curve.cumActual[idxForKpi] ?? 0) : 0;
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
    cumActual: { label: cumActualLabel, color: "var(--primary)" },
  };
  const varianceCfg: ChartConfig = {
    variance: { label: varianceLabel, color: "var(--destructive)" },
  };

  const hasData = curve.buckets.length > 0 && scoped.length > 0;
  const accent =
    deltaNow < 0
      ? "text-destructive"
      : deltaNow > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  const sign = deltaNow > 0 ? "+" : "";
  const appliedLabel = `${DIM_LABEL[dim]}: ${ownerKey || "All"} · n = ${n.toLocaleString()} tasks`;

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
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <TrendingUp className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Plan vs Actual — S-Curve</CardTitle>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {appliedLabel}
                </span>
              </button>
            </CollapsibleTrigger>

            <div className="flex items-center gap-2">
              <Select
                value={ownerKey || ALL_KEY}
                onValueChange={(v) => onOwnerKeyChange(v === ALL_KEY ? "" : v)}
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder={DIM_LABEL[dim]} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ALL_KEY} className="text-xs">
                    All ({DIM_LABEL[dim]} rollup)
                  </SelectItem>
                  {ownerOptions.map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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
                      실적 시작 기준일 없음 — {curve.excludedCount.toLocaleString()}건 실적 곡선 제외
                    </div>
                  )}
                </div>

                <ChartContainer config={cfg} className="h-[340px] w-full">
                  <ComposedChart data={data} margin={{ left: 12, right: 16, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis
                      yAxisId="cum"
                      tick={{ fontSize: 11 }}
                      domain={[0, "auto"]}
                      tickFormatter={(v) => (isTasks ? `${v}` : `${v}%`)}
                    />
                    <YAxis
                      yAxisId="bar"
                      orientation="right"
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
                        yAxisId="cum"
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
                      yAxisId="cum"
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
                      yAxisId="cum"
                      type="monotone"
                      dataKey="cumActual"
                      name={cumActualLabel}
                      stroke="var(--primary)"
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
                    <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {todayLabel && (
                      <ReferenceLine x={todayLabel} stroke="var(--destructive)" strokeDasharray="4 2" />
                    )}
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Bar dataKey="variance" name={varianceLabel} barSize={8}>
                      {data.map((row, i) => {
                        const v = row.variance as number | null;
                        const fill =
                          v == null
                            ? "var(--muted)"
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
