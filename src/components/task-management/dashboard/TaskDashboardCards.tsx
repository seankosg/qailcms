import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { AUTO_JUDGMENT_COLORS, DISCIPLINE_COLORS } from "@/lib/task-management/columns";
import { todayGap } from "@/lib/task-management/derived";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  discipline: string;
  task_no: string;
  task_name: string | null;
  actual_progress: number | null;
  plan_start: string | null;
  plan_end: string | null;
  slip_days: number | null;
  auto_judgment: string | null;
  level: string;
  pic: string | null;
}

export function TaskDashboardCards() {
  const { data = [] } = useQuery({
    queryKey: ["task-dashboard"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select(
          "id, discipline, task_no, task_name, actual_progress, plan_start, plan_end, slip_days, auto_judgment, level, pic",
        )
        .eq("level", "child")
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const counts = { 정상: 0, 주의: 0, 지연: 0, 위험: 0, 완료: 0 } as Record<string, number>;
  const byDiscipline = new Map<string, { total: number; behind: number; critical: number }>();
  const behindList: (Row & { gap: number })[] = [];

  for (const r of data) {
    const j = r.auto_judgment ?? "";
    if (counts[j] != null) counts[j]++;
    const cur = byDiscipline.get(r.discipline) ?? { total: 0, behind: 0, critical: 0 };
    cur.total++;
    const gap = todayGap(r);
    if (gap < -0.05) cur.behind++;
    if (j === "위험" || j === "지연") {
      cur.critical++;
      behindList.push({ ...r, gap });
    } else if (gap < -0.05) {
      behindList.push({ ...r, gap });
    }
    byDiscipline.set(r.discipline, cur);
  }

  behindList.sort((a, b) => a.gap - b.gap);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task 자동 판정 요약</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["정상", "주의", "지연", "위험", "완료"] as const).map((k) => (
              <Badge key={k} className={cn("px-3 py-1", AUTO_JUDGMENT_COLORS[k])}>
                {k}: {(counts[k] ?? 0).toLocaleString()}
              </Badge>
            ))}
          </div>
          <div className="space-y-1 text-xs">
            {[...byDiscipline.entries()].map(([d, s]) => (
              <div key={d} className="flex items-center gap-2">
                <Badge className={DISCIPLINE_COLORS[d] ?? "bg-muted"}>{d}</Badge>
                <span>Total {s.total}</span>
                <span className="text-rose-600">지연/위험 {s.critical}</span>
                <span className="text-amber-600">뒤짐 {s.behind}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behind Schedule (Top 10)</CardTitle>
        </CardHeader>
        <CardContent>
          {behindList.length === 0 ? (
            <p className="text-sm text-muted-foreground">지연된 task가 없습니다.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-1 text-left">공종</th>
                  <th className="px-2 py-1 text-left">Task</th>
                  <th className="px-2 py-1 text-left">담당</th>
                  <th className="px-2 py-1 text-right">Gap</th>
                  <th className="px-2 py-1 text-left">판정</th>
                </tr>
              </thead>
              <tbody>
                {behindList.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-t hover:bg-accent/30">
                    <td className="px-2 py-1">
                      <Badge className={DISCIPLINE_COLORS[r.discipline] ?? "bg-muted"}>
                        {r.discipline}
                      </Badge>
                    </td>
                    <td className="px-2 py-1">
                      <Link
                        to="/closure/task-management/raw-data"
                        search={{ q: r.task_no } as any}
                        className="font-mono text-primary hover:underline"
                      >
                        {r.task_no}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{r.task_name ?? ""}</div>
                    </td>
                    <td className="px-2 py-1">{r.pic ?? "-"}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-rose-600">
                      {(r.gap * 100).toFixed(1)}%p
                    </td>
                    <td className="px-2 py-1">
                      {r.auto_judgment && (
                        <Badge
                          className={
                            AUTO_JUDGMENT_COLORS[r.auto_judgment] ?? "bg-muted"
                          }
                        >
                          {r.auto_judgment}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}