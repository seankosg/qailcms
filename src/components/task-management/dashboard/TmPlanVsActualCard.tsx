import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  /** 여러 차트를 나란히 놓을 때 공통 x 창(ISO). 주지 않으면 자기 모집단으로 잡는다. */
  windowStart?: string | null;
  windowEnd?: string | null;
  /** 절단 후 자기 창(ISO)을 밖으로 알린다 — 공통 창 합집합 계산용 */
  onWindowResolved?: (start: string, end: string) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 메인 S-Curve 차트 높이(px). 미지정 시 340px. */
  chartHeight?: number;
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
  windowStart,
  windowEnd,
  onWindowResolved,
  open,
  onOpenChange,
  chartHeight = 340,
}: Props) {
  const snap = useTaskProgressSnapshot();
  const [unit, setUnit] = useState<CurveUnit>("pct");

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
  const accent =
    deltaNow < 0
      ? "text-destructive"
      : deltaNow > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  const sign = deltaNow > 0 ? "+" : "";

  const hasData = scoped.length > 0;


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
                    n = {n.toLocaleString()} tasks
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-semibold text-primary">{DIM_LABEL[dim]}</span>
                  <span className="text-muted-foreground">P</span>
                  <span className="tabular-nums">{conv(planNow).toFixed(1)}{unitSuffix}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">A</span>
                  <span className="tabular-nums">{conv(actualNow).toFixed(1)}{unitSuffix}</span>
                  <span className={cn("font-semibold tabular-nums", accent)}>
                    Δ {sign}{conv(deltaNow).toFixed(1)}{isTasks ? " tasks" : "pp"}
                  </span>
                  {curve.excludedCount > 0 && (
                    <span className="ml-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      실적 시작 기준일 없음 — {curve.excludedCount.toLocaleString()}건 제외
                    </span>
                  )}
                  {curve.excludedCount > 0 && (
                    <span className="ml-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      실적 시작 기준일 없음 — {curve.excludedCount.toLocaleString()}건 제외
                    </span>
                  )}
                </div>

              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
