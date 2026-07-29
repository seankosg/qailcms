import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AUTO_JUDGMENT_COLORS,
  DISCIPLINE_COLORS,
  TEAM_COLORS,
} from "@/lib/task-management/columns";
import { TASK_STAGE_LABELS } from "@/lib/task-management/schedule-utils";
import type { DelayTopItem } from "@/lib/task-management/delay-utils";
import { cn } from "@/lib/utils";

interface Props {
  items: DelayTopItem[];
  limit?: number;
}

type SortKey =
  | "discipline"
  | "team"
  | "taskNo"
  | "stage"
  | "hdecPic"
  | "plannedDate"
  | "daysLate"
  | "gap"
  | "planPct"
  | "actualPct"
  | "diffPp"
  | "judgment";

interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

const NUMERIC: SortKey[] = ["daysLate", "gap", "planPct", "actualPct", "diffPp"];

function getVal(r: DelayTopItem, k: SortKey): string | number {
  switch (k) {
    case "discipline":
      return r.discipline ?? "";
    case "team":
      return r.team ?? "";
    case "taskNo":
      return r.taskNo ?? "";
    case "stage":
      return TASK_STAGE_LABELS[r.stage] ?? "";
    case "hdecPic":
      return r.hdecPic || r.hdecEng || "";
    case "plannedDate":
      return r.plannedDate ?? "";
    case "daysLate":
      return r.daysLate;
    case "gap":
      return r.gap;
    case "planPct":
      return r.planPct;
    case "actualPct":
      return r.actualPct;
    case "diffPp":
      return r.diffPp;
    case "judgment":
      return r.judgment ?? "";
  }
}

function compareBy(a: DelayTopItem, b: DelayTopItem, specs: SortSpec[]): number {
  for (const s of specs) {
    const av = getVal(a, s.key);
    const bv = getVal(b, s.key);
    let cmp: number;
    if (NUMERIC.includes(s.key)) {
      cmp = (Number(av) || 0) - (Number(bv) || 0);
    } else {
      cmp = String(av).localeCompare(String(bv), "ko");
    }
    if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
  }
  return 0;
}

export function DelayTopTable({ items, limit = 20 }: Props) {
  const navigate = useNavigate();
  // 정본 정렬: gap 오름차순(가장 나쁜 격차 상단). 동률 시 daysLate 큰 순.
  const [sorts, setSorts] = useState<SortSpec[]>([
    { key: "gap", dir: "asc" },
    { key: "daysLate", dir: "desc" },
  ]);

  const rows = useMemo(() => {
    const sorted = sorts.length ? [...items].sort((a, b) => compareBy(a, b, sorts)) : items;
    return sorted.slice(0, limit);
  }, [items, sorts, limit]);

  const clickHeader = (key: SortKey, shift: boolean) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (!shift) {
        if (idx === -1) return [{ key, dir: "asc" }];
        const cur = prev[idx];
        if (cur.dir === "asc") return [{ key, dir: "desc" }];
        return []; // 세 번째 클릭 시 정렬 해제
      }
      // Shift+클릭 → 다중 정렬 토글
      if (idx === -1) return [...prev, { key, dir: "asc" }];
      const cur = prev[idx];
      if (cur.dir === "asc") {
        const next = [...prev];
        next[idx] = { key, dir: "desc" };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const renderSortIcon = (key: SortKey) => {
    const idx = sorts.findIndex((s) => s.key === key);
    if (idx === -1) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    const s = sorts[idx];
    return (
      <span className="ml-1 inline-flex items-center gap-0.5">
        {s.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {sorts.length > 1 && (
          <span className="text-[9px] font-bold text-primary">{idx + 1}</span>
        )}
      </span>
    );
  };

  const Th = ({
    k,
    align = "left",
    sticky = false,
    children,
  }: {
    k: SortKey;
    align?: "left" | "right" | "center";
    sticky?: boolean;
    children: React.ReactNode;
  }) => (
    <th
      className={cn(
        "cursor-pointer select-none px-2 py-1 whitespace-nowrap hover:bg-muted",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        sticky && "sticky left-0 z-30 bg-muted",
      )}
      onClick={(e) => clickHeader(k, e.shiftKey)}
      title="클릭: 정렬 · Shift+클릭: 다중 정렬 추가"
    >
      <span className="inline-flex items-center">
        {children}
        {renderSortIcon(k)}
      </span>
    </th>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          지연 Top {limit} 태스크
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            헤더 클릭: 정렬 · Shift+클릭: 다중 정렬
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
              <thead className="sticky top-0 z-20 bg-muted/60 [&_th]:bg-muted">
                <tr>
                  <Th k="discipline">공종</Th>
                  <Th k="team" sticky>Team</Th>
                  <Th k="taskNo">Task</Th>
                  <Th k="stage">대표 Stage</Th>
                  <Th k="hdecPic">HDEC PIC</Th>
                  <Th k="plannedDate" align="right">계획일</Th>
                  <Th k="gap" align="right">Gap(pp)</Th>
                  <Th k="daysLate" align="right">지연일(참고)</Th>
                  <Th k="planPct" align="right">계획 %</Th>
                  <Th k="actualPct" align="right">실적 %</Th>
                  <Th k="diffPp" align="right">차이(pp)</Th>
                  <Th k="judgment">판정</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
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
                    <td className="sticky left-0 z-10 bg-card px-2 py-1 shadow-[1px_0_0_0_hsl(var(--border))]">
                      {r.team ? (
                        <Badge className={TEAM_COLORS[r.team] ?? "bg-muted"}>{r.team}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
                    <td
                      className={cn(
                        "px-2 py-1 text-right tabular-nums font-semibold",
                        r.gap < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {r.gap >= 0 ? "+" : ""}
                      {r.gap.toFixed(1)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="tabular-nums text-muted-foreground">
                        {r.daysLate}d
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {r.planPct.toFixed(0)}%
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {r.actualPct.toFixed(0)}%
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 text-right tabular-nums font-semibold",
                        r.diffPp < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {r.diffPp >= 0 ? "+" : ""}
                      {r.diffPp.toFixed(1)}
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