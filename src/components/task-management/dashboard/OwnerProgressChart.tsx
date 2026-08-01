import { useMemo } from "react";
import { Building2, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}

/**
 * Team / Individual Progress 차트.
 * 수치 정본: computeOwnerLeaderboard (planPct/actualPct/diffPp/delayedTasks).
 * 이 컴포넌트는 자체 판정·자체 진도율 계산을 하지 않는다.
 */
export function OwnerProgressChart({
  items,
  asOfDate,
  dim,
  onDimChange,
  onOwnerClick,
  thresholds,
  limit = 15,
}: Props) {
  const viewMode: "team" | "individual" = dim === "team" ? "team" : "individual";

  const rows = useMemo(
    () => computeOwnerLeaderboard(items, asOfDate, dim, thresholds),
    [items, asOfDate, dim, thresholds],
  );

  // computeOwnerLeaderboard 는 diffPp 오름차순 정렬본을 반환한다 — 그대로 상위 N.
  const data = useMemo(() => rows.slice(0, limit), [rows, limit]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">
            {viewMode === "team" ? "Team Progress" : "Individual Progress"}
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Planned vs Actual — 막대 클릭 시 드릴다운
          </p>
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
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis
                  dataKey="key"
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}%`}
                  className="fill-muted-foreground"
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
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
                  fill="hsl(var(--muted-foreground))"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={22}
                  onClick={(d: any) =>
                    onOwnerClick?.(dim, d?.payload?.key, d?.payload as OwnerLeaderboardRow)
                  }
                  className="cursor-pointer"
                />
                <Bar
                  dataKey="actualPct"
                  name="Actual"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={22}
                  onClick={(d: any) =>
                    onOwnerClick?.(dim, d?.payload?.key, d?.payload as OwnerLeaderboardRow)
                  }
                  className="cursor-pointer"
                >
                  {data.map((r) => (
                    <Cell
                      key={r.key}
                      fill={
                        r.diffPp < 0
                          ? "hsl(var(--destructive))"
                          : "hsl(var(--primary))"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground" /> Plan
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /> Actual (지연)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
