import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { TM_COLUMNS } from "@/lib/task-management/columns";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";

interface Props {
  order: string[]; // full column order excluding __select/task_no
  visibility: Record<string, boolean>;
  frozenExtras: string[]; // up to 3 keys pinned right after task_no
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
  isAdmin?: boolean;
  onServerReorder?: (patches: Array<{ field_name: string; sort_order: number }>) => void;
  onServerVisibility?: (field_name: string, is_visible: boolean) => void;
}

export function ColumnOrderMenu({
  order,
  visibility,
  frozenExtras,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
  isAdmin,
  onServerReorder,
  onServerVisibility,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const resolveLabel = useTmColumnLabel();

  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReorderPersist = (nextOrder: string[]) => {
    if (!isAdmin || !onServerReorder) return;
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(() => {
      onServerReorder(nextOrder.map((k, i) => ({ field_name: k, sort_order: (i + 1) * 10 })));
    }, 400);
  };
  useEffect(() => () => { if (reorderTimer.current) clearTimeout(reorderTimer.current); }, []);

  const toggleFrozen = (k: string) => {
    if (frozenExtras.includes(k)) {
      onFrozenChange(frozenExtras.filter((x) => x !== k));
    } else {
      onFrozenChange([...frozenExtras, k]);
    }
  };

  const onDragStart = (k: string) => (e: React.DragEvent) => {
    setDragKey(k);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (k: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragKey || dragKey === k) return;
    const next = [...order];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(k);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    onOrderChange(next);
    scheduleReorderPersist(next);
  };
  const onDragEnd = () => setDragKey(null);

  const changeVisibility = (k: string, checked: boolean) => {
    onVisibilityChange({ ...visibility, [k]: checked });
    if (isAdmin && onServerVisibility) onServerVisibility(k, checked);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>
            드래그로 순서 변경 · 핀으로 좌측 고정({frozenExtras.length})
            {isAdmin ? " · 관리자: 순서/노출은 전체 사용자에 반영" : ""}
          </span>
          <button
            className="text-primary hover:underline"
            onClick={() => {
              onVisibilityChange({});
              onFrozenChange([]);
              onOrderChange(TM_COLUMNS.map((c) => c.key).filter((k) => k !== "task_no"));
            }}
          >
            Reset
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          <div className="mb-1 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Frozen · task_no (고정)
          </div>
          {frozenExtras.map((k) => (
            <div key={k} className="flex items-center gap-1 rounded px-1 py-1 text-xs">
              <Pin className="h-3 w-3 text-primary" />
              <span className="flex-1 truncate">{resolveLabel(k)}</span>
              <button
                className="text-[10px] text-muted-foreground hover:underline"
                onClick={() => toggleFrozen(k)}
              >
                unpin
              </button>
            </div>
          ))}
          <div className="mb-1 mt-2 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Columns
          </div>
          {order.map((k) => {
            if (frozenExtras.includes(k)) return null;
            const hidden = visibility[k] === false;
            return (
              <div
                key={k}
                draggable
                onDragStart={onDragStart(k)}
                onDragOver={onDragOver(k)}
                onDragEnd={onDragEnd}
                className={cn(
                  "group flex cursor-move items-center gap-1 rounded px-1 py-1 text-xs hover:bg-muted/50",
                  dragKey === k && "opacity-50",
                )}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/40" />
                <Checkbox
                  checked={!hidden}
                  onCheckedChange={(c) => changeVisibility(k, !!c)}
                  className="h-3 w-3"
                />
                <span className={cn("flex-1 truncate", hidden && "text-muted-foreground/50")}>
                  {resolveLabel(k)}
                </span>
                <button
                  className="text-[10px] text-muted-foreground hover:underline"
                  onClick={() => toggleFrozen(k)}
                  title="왼쪽 고정"
                >
                  pin
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}