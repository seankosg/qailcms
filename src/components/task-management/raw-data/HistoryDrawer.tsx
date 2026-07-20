import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { getTaskHistory } from "@/lib/task-management/history.functions";

interface Props {
  open: boolean;
  onClose: () => void;
  discipline: string | null;
  taskNo: string | null;
  taskName?: string | null;
}

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-slate-500/15 text-slate-700",
  import: "bg-sky-500/15 text-sky-700",
  rollup: "bg-violet-500/15 text-violet-700",
  system: "bg-zinc-500/15 text-zinc-700",
};

function fmt(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function HistoryDrawer({ open, onClose, discipline, taskNo, taskName }: Props) {
  const fetchHistory = useServerFn(getTaskHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["task-history", discipline, taskNo],
    queryFn: async () => {
      if (!discipline || !taskNo) return { rows: [] };
      return await fetchHistory({ data: { discipline, task_no: taskNo, limit: 100 } });
    },
    enabled: open && !!discipline && !!taskNo,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>변경 이력</SheetTitle>
          <SheetDescription>
            <span className="font-mono">{taskNo}</span>
            {taskName && ` · ${taskName}`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100dvh-8rem)] pr-3">
          {isLoading && <div className="text-sm text-muted-foreground">로딩 중…</div>}
          {!isLoading && (data?.rows ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">이력 없음</div>
          )}
          <div className="space-y-2">
            {(data?.rows ?? []).map((r: any) => (
              <div key={r.id} className="rounded border p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{r.field}</span>
                  <Badge className={SOURCE_COLORS[r.source] ?? "bg-muted"}>{r.source}</Badge>
                  <span className="ml-auto text-muted-foreground">{fmt(r.changed_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                    {r.old_value ?? "—"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px]">
                    {r.new_value ?? "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}