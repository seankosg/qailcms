import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
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
  defaultDim?: OwnerDim;
  onDimChange?: (dim: OwnerDim) => void;
  onOwnerClick?: (dim: OwnerDim, key: string, row: OwnerLeaderboardRow) => void;
  thresholds?: TaskThresholds;
}

const DIM_LABEL: Record<OwnerDim, string> = {
  team: "Team",
  hdec_pic_name: "HDEC PIC",
  hdec_eng_name: "HDEC ENG",
};

type SortKey = "key" | "taskCount" | "delayedTasks" | "planPct" | "actualPct" | "diffPp";
type SortDir = "asc" | "desc";

export function OwnerLeaderboardCard({ items, asOfDate, defaultDim = "hdec_pic_name", onDimChange, onOwnerClick, thresholds }: Props) {
  const [dim, setDim] = useState<OwnerDim>(defaultDim);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // 기본 정렬: 기존 동작(가장 뒤처진 담당자 상단) 유지 = diffPp 오름차순
  const [sortKey, setSortKey] = useState<SortKey>("diffPp");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // 이름은 오름차순, 수치는 큰 값 우선이 자연스러움
      setSortDir(k === "key" ? "asc" : "desc");
    }
  };

  const rows = useMemo(
    () => computeOwnerLeaderboard(items, asOfDate, dim, thresholds),
    [items, asOfDate, dim, thresholds],
  );
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = qq ? rows.filter((r) => r.key.toLowerCase().includes(qq)) : rows;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortKey === "key") return sign * a.key.localeCompare(b.key, "ko");
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (av === bv) return a.key.localeCompare(b.key, "ko");
      return sign * (av - bv);
    });
  }, [rows, q, sortKey, sortDir]);

  const handle = (v: string) => {
    if (v === "team" || v === "hdec_pic_name" || v === "hdec_eng_name") {
      setDim(v);
      onDimChange?.(v);
    }
  };

  const clickRow = (r: OwnerLeaderboardRow) => {
    if (r.key === "(미지정)") return;
    onOwnerClick?.(dim, r.key, r);
  };

  const delayedOwnerCount = rows.filter((r) => r.delayedTasks > 0).length;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-accent/40"
                aria-label={open ? "접기" : "펼치기"}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Users className="h-4 w-4 text-primary" />
                <span>담당자 Leaderboard</span>
              </button>
            </CollapsibleTrigger>
            <Badge variant="secondary" className="text-[10px]">
              {DIM_LABEL[dim]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              지연 담당자 {delayedOwnerCount}명
            </Badge>
            {open && (
              <div className="ml-auto flex items-center gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="이름 검색"
                  className="h-7 w-32 text-xs"
                />
                <Tabs value={dim} onValueChange={handle}>
                  <TabsList className="h-7">
                    {(Object.keys(DIM_LABEL) as OwnerDim[]).map((k) => (
                      <TabsTrigger key={k} value={k} className="h-5 px-2 text-[11px]">
                        {DIM_LABEL[k]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="p-0">
            <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <SortTh label={DIM_LABEL[dim]} k="key" align="left" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Task" k="taskCount" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="지연 Task" k="delayedTasks" align="right" title="통합 판정('지연'|'악화') 태스크 수" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="평균 진도(계획)" k="planPct" align="left" title="평균 진도(계획) — 판정 지표 아님" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="평균 진도(실적)" k="actualPct" align="left" title="평균 진도(실적) — 판정 지표 아님" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="차이(%p)" k="diffPp" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const diff = r.diffPp;
                const diffColor =
                  diff <= -10 ? "text-destructive" : diff < 0 ? "text-warning" : "text-emerald-600 dark:text-emerald-400";
                return (
                  <tr
                    key={r.key}
                    className="cursor-pointer border-t hover:bg-accent/30"
                    onClick={() => clickRow(r)}
                  >
                    <td className="px-2 py-1">
                      <div className="truncate font-medium" title={r.key}>{r.key}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.delayedTaskIds.size}개 태스크에 지연
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.taskCount}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-destructive">
                      {r.delayedTasks || "—"}
                    </td>
                    <td className="px-2 py-1">
                      <ProgressBar pct={r.planPct} color="bg-schedule-plan" />
                    </td>
                    <td className="px-2 py-1">
                      <ProgressBar pct={r.actualPct} color="bg-schedule-actual" />
                    </td>
                    <td className={cn("px-2 py-1 text-right tabular-nums font-semibold", diffColor)}>
                      {diff >= 0 ? "+" : ""}
                      {diff.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">
                    표시할 담당자가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 min-w-[60px] overflow-hidden rounded bg-muted">
        <div className={cn("h-full", color)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {pct.toFixed(0)}
      </span>
    </div>
  );
}

function SortTh({
  label,
  k,
  align,
  title,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  align: "left" | "right";
  title?: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-2 py-1", align === "right" ? "text-right" : "text-left")} title={title}>
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-accent/40",
          active && "text-foreground font-semibold",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
}