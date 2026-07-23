import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AUTO_JUDGMENT_COLORS, DISCIPLINE_COLORS } from "@/lib/task-management/columns";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import { computeVariance } from "@/lib/task-management/derived";

interface Props {
  items: TaskItem[];
  limit?: number;
}

export function BehindScheduleTable({ items, limit = 20 }: Props) {
  const behindList = items
    .map((r) => ({ ...r, gap: computeVariance(r) ?? 0 }))
    .filter((r) => r.gap < -0.001 && Number(r.actual_progress ?? 0) < 1)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, limit);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Behind Schedule (Top {limit})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {behindList.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">지연된 Task 없음.</p>
        ) : (
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="px-2 py-1 text-left">공종</th>
                  <th className="px-2 py-1 text-left">Task</th>
                  <th className="px-2 py-1 text-left">담당</th>
                  <th className="px-2 py-1 text-right">계획%</th>
                  <th className="px-2 py-1 text-right">실적%</th>
                  <th className="px-2 py-1 text-right">Gap</th>
                  <th className="px-2 py-1 text-left">판정</th>
                </tr>
              </thead>
              <tbody>
                {behindList.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-accent/30">
                    <td className="px-2 py-1">
                      <Badge className={DISCIPLINE_COLORS[r.discipline ?? ""] ?? "bg-muted"}>
                        {r.discipline ?? "-"}
                      </Badge>
                    </td>
                    <td className="px-2 py-1">
                      <Link
                        to="/closure/task-management/raw-data"
                        search={{ q: r.task_no ?? "" } as any}
                        className="font-mono text-primary hover:underline"
                      >
                        {r.task_no}
                      </Link>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                        {r.task_name ?? ""}
                      </div>
                    </td>
                    <td className="px-2 py-1">{r.hdec_pic_name ?? r.hdec_eng_name ?? "-"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {((r.gap + Number(r.actual_progress ?? 0)) * 100).toFixed(0)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {(Number(r.actual_progress ?? 0) * 100).toFixed(0)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-schedule-short">
                      {(r.gap * 100).toFixed(1)}%p
                    </td>
                    <td className="px-2 py-1">
                      {r.auto_judgment && (
                        <Badge className={AUTO_JUDGMENT_COLORS[r.auto_judgment] ?? "bg-muted"}>
                          {r.auto_judgment}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}