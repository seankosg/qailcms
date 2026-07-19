import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AUTO_JUDGMENT_COLORS,
  DISCIPLINE_COLORS,
} from "@/lib/task-management/columns";
import { TASK_STAGE_LABELS } from "@/lib/task-management/schedule-utils";
import type { DelayTopItem } from "@/lib/task-management/delay-utils";

interface Props {
  items: DelayTopItem[];
  limit?: number;
}

export function DelayTopTable({ items, limit = 20 }: Props) {
  const navigate = useNavigate();
  const rows = items.slice(0, limit);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          지연 Top {limit} 태스크
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            지연일수 내림차순
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            현재 지연된 스테이지가 없습니다.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="px-2 py-1 text-left">공종</th>
                  <th className="px-2 py-1 text-left">Task</th>
                  <th className="px-2 py-1 text-left">Stage</th>
                  <th className="px-2 py-1 text-left">HDEC PIC</th>
                  <th className="px-2 py-1 text-right">계획일</th>
                  <th className="px-2 py-1 text-right">지연일</th>
                  <th className="px-2 py-1 text-left">판정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.id}-${r.stage}`}
                    className="cursor-pointer border-t hover:bg-accent/30"
                    onClick={() =>
                      navigate({
                        to: "/closure/task-management/detail/$id",
                        params: { id: String(r.id) },
                      })
                    }
                  >
                    <td className="px-2 py-1">
                      <Badge className={DISCIPLINE_COLORS[r.discipline] ?? "bg-muted"}>
                        {r.discipline || "-"}
                      </Badge>
                    </td>
                    <td className="px-2 py-1">
                      <div className="font-mono text-primary hover:underline">{r.taskNo}</div>
                      <div className="max-w-[240px] truncate text-[10px] text-muted-foreground">
                        {r.taskName}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                        {TASK_STAGE_LABELS[r.stage]}
                      </span>
                    </td>
                    <td className="px-2 py-1 truncate max-w-[100px]">
                      {r.hdecPic || r.hdecEng || "-"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {r.plannedDate}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="tabular-nums font-semibold text-destructive">
                        {r.daysLate}d
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      {r.judgment && (
                        <Badge className={AUTO_JUDGMENT_COLORS[r.judgment] ?? "bg-muted"}>
                          {r.judgment}
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