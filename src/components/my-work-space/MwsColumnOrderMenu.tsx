import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pin } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  order: string[];
  visibility: Record<string, boolean>;
  frozen: string[];
  forcedFrozen?: string[]; // 사용자 해제 불가 (예: __ctx)
  labels: Record<string, string>;
  defaultOrder: string[];
  defaultVisibility: Record<string, boolean>;
  defaultFrozen: string[];
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
}

export function MwsColumnOrderMenu({
  order,
  visibility,
  frozen,
  forcedFrozen = [],
  labels,
  defaultOrder,
  defaultVisibility,
  defaultFrozen,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const resolveLabel = (k: string) => labels[k] ?? k;
  const isForced = (k: string) => forcedFrozen.includes(k);

  const toggleFrozen = (k: string) => {
    if (isForced(k)) return;
    if (frozen.includes(k)) onFrozenChange(frozen.filter((x) => x !== k));
    else onFrozenChange([...frozen, k]);
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
  };
  const onDragEnd = () => setDragKey(null);

  const changeVisibility = (k: string, checked: boolean) => {
    onVisibilityChange({ ...visibility, [k]: checked });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]">
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>드래그로 순서 · 핀으로 좌측 고정({frozen.length})</span>
          <button
            className="text-primary hover:underline"
            onClick={() => {
              onVisibilityChange({ ...defaultVisibility });
              onFrozenChange([...defaultFrozen]);
              onOrderChange([...defaultOrder]);
            }}
          >
            Reset
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          <div className="mb-1 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Frozen (고정)
          </div>
          {frozen.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted-foreground/60">고정 컬럼 없음</div>
          ) : (
            frozen.map((k) => (
              <div key={k} className="flex items-center gap-1 rounded px-1 py-1 text-xs">
                <Pin className="h-3 w-3 text-primary" />
                <span className="flex-1 truncate">{resolveLabel(k)}</span>
                {isForced(k) ? (
                  <span className="text-[10px] text-muted-foreground/60">필수</span>
                ) : (
                  <button
                    className="text-[10px] text-muted-foreground hover:underline"
                    onClick={() => toggleFrozen(k)}
                  >
                    unpin
                  </button>
                )}
              </div>
            ))
          )}
          <div className="mb-1 mt-2 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Columns
          </div>
          {order.map((k) => {
            if (frozen.includes(k)) return null;
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