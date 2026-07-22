import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { computeWeeklyDelayTrend } from "@/lib/task-management/delay-utils";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import { formatDdMmm } from "@/lib/time/doha";

interface Props {
  items: TaskItem[];
  today: string;
  weeks?: number;
}

const cfg: ChartConfig = {
  newDelays: { label: "신규 지연", color: "hsl(var(--destructive))" },
  recovered: { label: "회복(완료)", color: "hsl(var(--success, 142 71% 45%))" },
  openDelays: { label: "잔여 지연", color: "hsl(var(--muted-foreground))" },
  net: { label: "Net(신규-회복)", color: "hsl(var(--warning))" },
};

export function WeeklyDelayTrend({ items, today, weeks = 12 }: Props) {
  const points = useMemo(() => computeWeeklyDelayTrend(items, today, weeks), [items, today, weeks]);
  const data = points.map((p) => ({
    label: formatDdMmm(p.weekStart),
    ...p,
  }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Activity className="h-4 w-4 text-warning" />
          주간 신규 지연 vs 회복 트렌드
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            최근 {weeks}주
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={cfg} className="h-[220px] w-full">
          <ComposedChart data={data} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="bar" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis yAxisId="line" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="bar" dataKey="newDelays" name="신규 지연" fill="hsl(var(--destructive))" barSize={12} />
            <Bar yAxisId="bar" dataKey="recovered" name="회복(완료)" barSize={12}>
              {data.map((_, i) => (
                <Cell key={i} fill="hsl(142 71% 45%)" />
              ))}
            </Bar>
            <Line
              yAxisId="line"
              type="monotone"
              dataKey="openDelays"
              name="잔여 지연"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              dot={{ r: 2 }}
            />
            <Line
              yAxisId="line"
              type="monotone"
              dataKey="net"
              name="Net"
              stroke="hsl(var(--warning))"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}