import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, History } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,

  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { getTaskProgressChartDetail } from "@/lib/task-management/progress-chart.functions";
import { HistoryDrawer } from "@/components/task-management/raw-data/HistoryDrawer";
import { formatDdMmm, formatDdMmmYyyy } from "@/lib/time/doha";

interface Props {
  open: boolean;
  onClose: () => void;
  discipline: string;
  taskNo: string | null;
  taskName?: string | null;
}

export function TaskProgressChartDialog({
  open,
  onClose,
  discipline,
  taskNo,
  taskName,
}: Props) {
  const fetchDetail = useServerFn(getTaskProgressChartDetail);
  const { data, isLoading, error } = useQuery({
    queryKey: ["task-progress-chart-detail", discipline, taskNo],
    queryFn: () =>
      fetchDetail({ data: { discipline, task_no: taskNo as string } }),
    enabled: open && !!taskNo,
    staleTime: 0,
    gcTime: 60_000,
  });

  const [showHistory, setShowHistory] = useState(false);

  // Merge plan/actual into a unified series by date
  const series = (() => {
    if (!data) return [];
    const map = new Map<string, { d: string; plan?: number; actual?: number }>();
    for (const p of data.plan_points) {
      const cur = map.get(p.d) ?? { d: p.d };
      cur.plan = Number((p.v * 100).toFixed(2));
      map.set(p.d, cur);
    }
    for (const p of data.actual_points) {
      const cur = map.get(p.d) ?? { d: p.d };
      cur.actual = Number((p.v * 100).toFixed(2));
      map.set(p.d, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.d < b.d ? -1 : 1));
  })();

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {taskNo}
              </span>
              <span className="text-base font-semibold">
                {taskName ?? data?.task_name ?? "-"}
              </span>
              <span className="ml-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[hsl(215_90%_55%)]" />
                계획
                <span className="ml-1 inline-block h-1.5 w-3 rounded-sm bg-[hsl(0_80%_55%)]" />
                실적
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                onClick={() => setShowHistory(true)}
              >
                <History className="mr-1 h-3.5 w-3.5" />
                이력 보기
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="h-[360px] w-full">
            {isLoading && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                차트 계산 중…
              </div>
            )}
            {error && (
              <div className="flex h-full items-center justify-center text-sm text-destructive">
                차트를 불러오지 못했습니다: {(error as Error).message}
              </div>
            )}
            {!isLoading && !error && data && series.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series}
                  margin={{ top: 10, right: 24, left: 0, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                  <XAxis
                    dataKey="d"
                    tick={{ fontSize: 11 }}
                    minTickGap={30}
                    tickFormatter={(v: string) => formatDdMmm(v) || v}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    width={44}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${Number(value).toFixed(1)}%`,
                      name === "plan" ? "계획" : "실적",
                    ]}
                    labelFormatter={(l) => `날짜: ${formatDdMmmYyyy(String(l)) || l}`}
                  />
                  <Legend
                    formatter={(v) => (v === "plan" ? "계획" : "실적")}
                  />
                  {data.data_date && (
                    <ReferenceLine
                      x={String(data.data_date).slice(0, 10)}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      label={{
                        value: "Data Date",
                        position: "top",
                        fontSize: 10,
                        fill: "hsl(var(--muted-foreground))",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke="hsl(215 90% 55%)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="hsl(0 80% 55%)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
            {!isLoading && !error && data && series.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                표시할 데이터가 없습니다.
              </div>
            )}
          </div>
          <p className="px-1 pb-1 text-[11px] text-muted-foreground">
            실적 곡선은 착수일과 최근 관측치를 잇는 추정선입니다.
          </p>
        </DialogContent>
      </Dialog>

      <HistoryDrawer
        open={showHistory}
        onClose={() => setShowHistory(false)}
        discipline={discipline}
        taskNo={taskNo}
        taskName={taskName ?? data?.task_name ?? null}
      />
    </>
  );
}