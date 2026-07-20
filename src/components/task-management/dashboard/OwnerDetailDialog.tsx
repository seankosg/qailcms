import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DelayTopTable } from "./DelayTopTable";
import {
  computeDelayTopN,
  type OwnerDim,
  type OwnerLeaderboardRow,
} from "@/lib/task-management/delay-utils";
import type { TaskItem } from "@/lib/task-management/schedule-utils";

const DIM_LABEL: Record<OwnerDim, string> = {
  team: "Team",
  hdec_pic_name: "HDEC PIC",
  hdec_eng_name: "HDEC ENG",
};

const DIM_PARAM: Record<OwnerDim, string> = {
  team: "team",
  hdec_pic_name: "hdec_pic_name",
  hdec_eng_name: "hdec_eng_name",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dim: OwnerDim;
  ownerKey: string;
  row: OwnerLeaderboardRow | null;
  items: TaskItem[];
  asOfDate: string;
}

export function OwnerDetailDialog({ open, onOpenChange, dim, ownerKey, row, items, asOfDate }: Props) {
  const navigate = useNavigate();

  const ownerItems = useMemo(() => {
    if (!ownerKey) return [] as TaskItem[];
    return items.filter((it) => {
      const v = (it as any)[dim];
      return v && String(v).trim() === ownerKey;
    });
  }, [items, dim, ownerKey]);

  const delayTop = useMemo(
    () => computeDelayTopN(ownerItems, asOfDate, 50),
    [ownerItems, asOfDate],
  );

  const goRawData = () => {
    navigate({
      to: "/closure/task-management/raw-data",
      search: {
        [DIM_PARAM[dim]]: ownerKey,
        source: "dashboard",
        mode: "delay",
        asOf: asOfDate,
      } as any,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground text-xs">{DIM_LABEL[dim]}</span>
            <span>{ownerKey}</span>
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={goRawData}>
              <ExternalLink className="mr-1 h-3 w-3" /> Raw Data 열기
            </Button>
          </DialogTitle>
        </DialogHeader>

        {row && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <StatCard label="담당 Task" value={row.taskCount} />
            <StatCard label="총 스테이지" value={row.totalStages} />
            <StatCard label="완료" value={row.doneStages} tone="success" />
            <StatCard label="지연 스테이지" value={row.delayedStages} tone="destructive" />
            <StatCard
              label="Plan vs Actual"
              value={`${row.actualPct.toFixed(0)}% / ${row.planPct.toFixed(0)}%`}
              hint={`${row.diffPp >= 0 ? "+" : ""}${row.diffPp.toFixed(1)}pp`}
              tone={row.diffPp < 0 ? "destructive" : "success"}
            />
          </div>
        )}

        <div className="mt-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px]">지연 Top 50</Badge>
            <span>{ownerKey} 의 지연 스테이지 상세</span>
          </div>
          <DelayTopTable items={delayTop} limit={50} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "success" | "destructive";
}) {
  const toneCls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className={`text-[10px] tabular-nums ${toneCls}`}>{hint}</div>}
    </div>
  );
}