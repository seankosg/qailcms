import { useMemo } from "react";
import { Building2, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  computeOwnerLeaderboard,
  type OwnerDim,
  type OwnerLeaderboardRow,
} from "@/lib/task-management/delay-utils";
import type { TaskThresholds } from "@/lib/task-management/derived";

interface Props {
  items: TaskItem[];
  asOfDate: string;
  dim: OwnerDim;
  onDimChange?: (dim: OwnerDim) => void;
  onOwnerClick?: (dim: OwnerDim, key: string, row: OwnerLeaderboardRow) => void;
  thresholds?: TaskThresholds;
  /** 표시할 상위 그룹 수 (diffPp 오름차순 = 가장 뒤처진 순) */
  limit?: number;
  /** 제목 옆에 표시할 선택된 팀/사용자 라벨 */
  titleSuffix?: string;
}


/**
 * Team / Individual Progress 차트.
 * 수치 정본: computeOwnerLeaderboard (planPct/actualPct/diffPp/delayedTasks).
 * 이 컴포넌트는 자체 판정·자체 진도율 계산을 하지 않는다.
 */
const COLOR_PLAN = "color-mix(in oklab, var(--muted-foreground) 35%, transparent)";
const COLOR_ACTUAL = "var(--primary)";
const COLOR_BEHIND = "var(--destructive)";
const COLOR_AHEAD = "var(--success)";

export function OwnerProgressChart({
  items,
  asOfDate,
  dim,
  onDimChange,
  onOwnerClick,
  thresholds,
  limit = 15,
  titleSuffix,
}: Props) {

  const viewMode: "team" | "individual" = dim === "team" ? "team" : "individual";

  const rows = useMemo(
    () => computeOwnerLeaderboard(items, asOfDate, dim, thresholds),
    [items, asOfDate, dim, thresholds],
  );

  // Team: 정본 정렬(diffPp 오름차순) 유지.
  // Individual: 지연 건수 많은 순(내림차순) → 동률 시 diffPp 오름차순.
  const data = useMemo(() => {
    if (viewMode === "team") return rows.slice(0, limit);
    return [...rows]
      .sort((a, b) => b.delayedTasks - a.delayedTasks || a.diffPp - b.diffPp || a.key.localeCompare(b.key, "ko"))
      .slice(0, limit);
  }, [rows, limit, viewMode]);

  // 요약치 — 정본 행값의 태스크수 가중 평균(= 태스크 단위 평균과 동일 정의). 별도 판정 계산 없음.
  const summary = useMemo(() => {
    let tasks = 0;
    let delayed = 0;
    let plan = 0;
    let actual = 0;
    for (const r of rows) {
      tasks += r.taskCount;
      delayed += r.delayedTasks;
      plan += r.planPct * r.taskCount;
      actual += r.actualPct * r.taskCount;
    }
    return {
      tasks,
      delayed,
      planPct: tasks ? plan / tasks : 0,
      actualPct: tasks ? actual / tasks : 0,
    };
  }, [rows]);

  // 지연 필터로 사전 필터링된 모집단이면 모든 항목이 지연 → ▼카운트·"지연" 배지 중복 제거
  const allDelayed = summary.delayed === summary.tasks;

  const needsScroll = data.length > 10;
  const chartWidth = needsScroll ? data.length * 72 : undefined;

  const renderPlanLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (typeof value !== "number") return null;
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        textAnchor="middle"
        fontSize={10}
        fill="var(--muted-foreground)"
      >
        {value.toFixed(0)}%
      </text>
    );
  };

  const renderActualLabel = (props: any) => {
    const { x, y, width, value, index } = props;
    const r = data[index];
    if (!r || typeof value !== "number") return null;
    const gapColor = r.diffPp >= 0 ? COLOR_AHEAD : COLOR_BEHIND;
    return (
      <g>
        <text x={x + width / 2} y={y - 33} textAnchor="middle" fontSize={9} fontWeight={700}>
          <tspan fill="var(--muted-foreground)">{r.taskCount}건</tspan>
          {!allDelayed && r.delayedTasks > 0 && (
            <tspan fill={COLOR_BEHIND}> ▼{r.delayedTasks}</tspan>
          )}
        </text>
        <text
          x={x + width / 2}
          y={y - 19}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill={gapColor}
        >
          {r.diffPp >= 0 ? "+" : ""}
          {r.diffPp.toFixed(1)}pp
        </text>
        <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fill="var(--foreground)">
          {value.toFixed(0)}%
        </text>
      </g>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">
              {viewMode === "team" ? "Team Progress" : "Individual Progress"}
            </CardTitle>
            {titleSuffix && titleSuffix !== "All" && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                {titleSuffix}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Planned vs Actual — 막대 클릭 시 드릴다운
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
              전체 {summary.tasks.toLocaleString()}건
            </Badge>
            {!allDelayed && (
              <Badge variant="destructive" className="h-5 px-1.5 text-[10px] tabular-nums">
                지연 {summary.delayed.toLocaleString()}건
              </Badge>
            )}
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
              진도율 {summary.actualPct.toFixed(1)}% / 계획 {summary.planPct.toFixed(1)}%
            </Badge>
            <span
              className={
                summary.actualPct - summary.planPct >= 0
                  ? "text-[10px] font-semibold tabular-nums text-[var(--success)]"
                  : "text-[10px] font-semibold tabular-nums text-destructive"
              }
            >
              {summary.actualPct - summary.planPct >= 0 ? "+" : ""}
              {(summary.actualPct - summary.planPct).toFixed(1)}pp
            </span>
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => {
            if (!v || !onDimChange) return;
            onDimChange(v === "team" ? "team" : "hdec_pic_name");
          }}
          className="gap-1"
        >
          <ToggleGroupItem
            value="team"
            aria-label="Team"
            className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            <Building2 className="mr-1 h-3.5 w-3.5" /> Team
          </ToggleGroupItem>
          <ToggleGroupItem
            value="individual"
            aria-label="Individual"
            className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            <Users className="mr-1 h-3.5 w-3.5" /> Individual
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="pt-1">
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <div className={needsScroll ? "overflow-x-auto" : ""}>
            <div
              className="h-[360px]"
              style={chartWidth ? { width: chartWidth, minWidth: "100%" } : { width: "100%" }}
            >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                barGap={2}
                barCategoryGap="20%"
                margin={{ top: 46, right: 8, left: -16, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="key"
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={64}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: "color-mix(in oklab, var(--muted) 60%, transparent)", radius: 4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r = payload[0].payload as OwnerLeaderboardRow;
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="mb-1 font-semibold text-popover-foreground">{r.key}</div>
                        <div className="tabular-nums text-muted-foreground">
                          Plan {r.planPct.toFixed(1)}% / Actual {r.actualPct.toFixed(1)}%
                        </div>
                        <div
                          className={
                            r.diffPp < 0
                              ? "tabular-nums text-destructive"
                              : "tabular-nums text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          Gap {r.diffPp >= 0 ? "+" : ""}
                          {r.diffPp.toFixed(1)}pp
                        </div>
                        <div className="tabular-nums text-muted-foreground">
                          Task {r.taskCount} · 지연 {r.delayedTasks}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="planPct"
                  name="Plan"
                  fill={COLOR_PLAN}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  onClick={(d: any) =>
                    onOwnerClick?.(dim, d?.payload?.key, d?.payload as OwnerLeaderboardRow)
                  }
                  className="cursor-pointer"
                >
                  <LabelList dataKey="planPct" content={renderPlanLabel} />
                </Bar>
                <Bar
                  dataKey="actualPct"
                  name="Actual"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  onClick={(d: any) =>
                    onOwnerClick?.(dim, d?.payload?.key, d?.payload as OwnerLeaderboardRow)
                  }
                  className="cursor-pointer"
                >
                  {data.map((r) => (
                    <Cell key={r.key} fill={r.diffPp < 0 ? COLOR_BEHIND : COLOR_ACTUAL} />
                  ))}
                  <LabelList dataKey="actualPct" content={renderActualLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: COLOR_PLAN }}
            />{" "}
            Plan
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /> Actual (지연)
          </span>
          {!allDelayed && <span className="flex items-center gap-1">▼ 지연 태스크 수 · n건 = 전체 태스크 수</span>}
          {allDelayed && <span className="flex items-center gap-1">n건 = 지연 태스크 수</span>}
        </div>
      </CardContent>
    </Card>
  );
}
