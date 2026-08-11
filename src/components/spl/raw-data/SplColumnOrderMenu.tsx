import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pin, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPL_DEFAULT_ORDER, SPL_DEFAULT_VISIBILITY } from "./spl-columns";

interface Props {
  items: Array<{ key: string; label: string; title?: string }>;
  order: string[];
  visibility: Record<string, boolean>;
  frozenExtras: string[];
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
  onSave?: () => void;
}

export function SplColumnOrderMenu({
  items,
  order,
  visibility,
  frozenExtras,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
  onSave,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const itemMap = new Map(items.map((item) => [item.key, item] as const));

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = order.filter((k) => k !== from);
    const idx = next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    onOrderChange(next);
  };

  const toggleFrozen = (k: string) =>
    onFrozenChange(frozenExtras.includes(k) ? frozenExtras.filter((x) => x !== k) : [...frozenExtras, k]);

  const visibleCount = order.filter((k) => itemMap.has(k) && visibility[k] !== false).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs">
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Columns ({visibleCount})
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
              const stageKeys = items.filter((item) => item.key.startsWith("stage:")).map((item) => item.key);
              onOrderChange([...SPL_DEFAULT_ORDER, ...stageKeys]);
              onVisibilityChange({ ...SPL_DEFAULT_VISIBILITY, ...Object.fromEntries(stageKeys.map((k) => [k, true])) });
              onFrozenChange([]);
            }}
          >
            <RotateCcw className="mr-0.5 h-3 w-3" />
            Reset
          </Button>
        </div>
        <div className="max-h-80 space-y-0.5 overflow-auto">
          {order.filter((k) => itemMap.has(k)).map((k) => (
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
              <span className="flex-1 truncate" title={itemMap.get(k)?.title}>{itemMap.get(k)?.label ?? k}</span>
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