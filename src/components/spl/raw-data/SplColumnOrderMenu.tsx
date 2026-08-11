import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pin, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPL_COLUMNS, SPL_DEFAULT_ORDER, SPL_DEFAULT_VISIBILITY } from "./spl-columns";

interface Props {
  order: string[];
  visibility: Record<string, boolean>;
  frozenExtras: string[];
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
  onSave?: () => void;
  /** 스테이지(밴드) 컬럼 — 일반 컬럼과 동일하게 순서·표시 제어 */
  stageItems?: Array<{ key: string; label: string; title: string }>;
  stageOrder?: string[];
  stageVisibility?: Record<string, boolean>;
  onStageOrderChange?: (next: string[]) => void;
  onStageVisibilityChange?: (next: Record<string, boolean>) => void;
}

const LABEL = new Map(SPL_COLUMNS.map((c) => [c.key, c.label] as const));

export function SplColumnOrderMenu({
  order,
  visibility,
  frozenExtras,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
  onSave,
  stageItems = [],
  stageOrder = [],
  stageVisibility = {},
  onStageOrderChange,
  onStageVisibilityChange,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [stageDragKey, setStageDragKey] = useState<string | null>(null);

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = order.filter((k) => k !== from);
    const idx = next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    onOrderChange(next);
  };

  const toggleFrozen = (k: string) =>
    onFrozenChange(frozenExtras.includes(k) ? frozenExtras.filter((x) => x !== k) : [...frozenExtras, k]);

  const visibleCount = order.filter((k) => visibility[k] !== false).length;
  const stageMap = new Map(stageItems.map((s) => [s.key, s] as const));
  const stageKeys = [
    ...stageOrder.filter((k) => stageMap.has(k)),
    ...stageItems.map((s) => s.key).filter((k) => !stageOrder.includes(k)),
  ];
  const visibleStageCount = stageKeys.filter((k) => stageVisibility[k] !== false).length;

  const moveStage = (from: string, to: string) => {
    if (from === to || !onStageOrderChange) return;
    const next = stageKeys.filter((k) => k !== from);
    const idx = next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    onStageOrderChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs">
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Columns ({visibleCount + visibleStageCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium">Order · visibility · pin</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-[10px]"
            onClick={() => {
              onOrderChange([...SPL_DEFAULT_ORDER]);
              onVisibilityChange({ ...SPL_DEFAULT_VISIBILITY });
              onFrozenChange([]);
              onStageOrderChange?.(stageItems.map((s) => s.key));
              onStageVisibilityChange?.({});
            }}
          >
            <RotateCcw className="mr-0.5 h-3 w-3" />
            Reset
          </Button>
        </div>
        <div className="max-h-80 space-y-0.5 overflow-auto">
          {order.map((k) => (
            <div
              key={k}
              draggable
              onDragStart={() => setDragKey(k)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragKey && dragKey !== k) move(dragKey, k);
              }}
              onDragEnd={() => setDragKey(null)}
              className={cn(
                "flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-muted",
                dragKey === k && "opacity-50",
              )}
            >
              <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
              <Checkbox
                checked={visibility[k] !== false}
                onCheckedChange={(v) => onVisibilityChange({ ...visibility, [k]: !!v })}
              />
              <span className="flex-1 truncate">{LABEL.get(k) ?? k}</span>
              <button
                type="button"
                title="Pin to left"
                onClick={() => toggleFrozen(k)}
                className={cn(
                  "rounded p-0.5 hover:bg-muted-foreground/20",
                  frozenExtras.includes(k) ? "text-primary" : "text-muted-foreground/50",
                )}
              >
                <Pin className="h-3 w-3" />
              </button>
            </div>
          ))}
          {stageKeys.length > 0 && (
            <>
              <div className="mt-2 border-t pt-1 text-[10px] font-medium text-muted-foreground">
                Stage columns ({visibleStageCount}/{stageKeys.length})
              </div>
              <div className="flex gap-1 pb-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1 text-[10px]"
                  onClick={() =>
                    onStageVisibilityChange?.(Object.fromEntries(stageKeys.map((k) => [k, true])))
                  }
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1 text-[10px]"
                  onClick={() =>
                    onStageVisibilityChange?.(Object.fromEntries(stageKeys.map((k) => [k, false])))
                  }
                >
                  None
                </Button>
              </div>
              {stageKeys.map((k) => (
                <div
                  key={k}
                  draggable
                  onDragStart={() => setStageDragKey(k)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (stageDragKey && stageDragKey !== k) moveStage(stageDragKey, k);
                  }}
                  onDragEnd={() => setStageDragKey(null)}
                  className={cn(
                    "flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-muted",
                    stageDragKey === k && "opacity-50",
                  )}
                  title={stageMap.get(k)?.title}
                >
                  <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
                  <Checkbox
                    checked={stageVisibility[k] !== false}
                    onCheckedChange={(v) =>
                      onStageVisibilityChange?.({ ...stageVisibility, [k]: !!v })
                    }
                  />
                  <span className="flex-1 truncate">{stageMap.get(k)?.label ?? k}</span>
                </div>
              ))}
            </>
          )}
        </div>
        {onSave && (
          <Button size="sm" className="mt-2 h-7 w-full text-[11px]" onClick={onSave}>
            Save current column settings
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}