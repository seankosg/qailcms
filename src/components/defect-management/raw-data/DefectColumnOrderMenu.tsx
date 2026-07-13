import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Lock, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFECT_COLUMNS } from "@/lib/defect-management/columns";
import { useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";

const SYSTEM_FROZEN: { id: string; label: string }[] = [
  { id: "__select", label: "Select" },
  { id: "is_critical", label: "Critical" },
  { id: "stage_progress", label: "Progress" },
];

interface Props {
  order: string[]; // 데이터 컬럼 순서 (is_critical 제외)
  visibility: Record<string, boolean>;
  frozenExtras: string[]; // 사용자 pin (최대 3)
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
}

export function DefectColumnOrderMenu({
  order,
  visibility,
  frozenExtras,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const { getLabel } = useDefectFieldHelpers();

  const resolveLabel = (k: string): string => {
    const sys = SYSTEM_FROZEN.find((s) => s.id === k);
    if (sys) return sys.label;
    return getLabel(k) || k;
  };

  const toggleFrozen = (k: string) => {
    if (frozenExtras.includes(k)) {
      onFrozenChange(frozenExtras.filter((x) => x !== k));
    } else if (frozenExtras.length < 3) {
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
  };
  const onDragEnd = () => setDragKey(null);

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
          <span>드래그로 순서 변경 · 핀으로 좌측 고정 ({frozenExtras.length}/3)</span>
          <button
            className="text-primary hover:underline"
            onClick={() => {
              onVisibilityChange({});
              onFrozenChange([]);
              onOrderChange(
                DEFECT_COLUMNS.map((c) => c.key).filter((k) => k !== "is_critical"),
              );
            }}
          >
            Reset
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          <div className="mb-1 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Frozen · 시스템 (고정)
          </div>
          {SYSTEM_FROZEN.map((s) => (
            <div key={s.id} className="flex items-center gap-1 rounded px-1 py-1 text-xs">
              <Lock className="h-3 w-3 text-muted-foreground/70" />
              <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
            </div>
          ))}
          {frozenExtras.length > 0 && (
            <>
              <div className="mb-1 mt-2 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Frozen · 사용자
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
            </>
          )}
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
                  onCheckedChange={(c) => onVisibilityChange({ ...visibility, [k]: !!c })}
                  className="h-3 w-3"
                />
                <span className={cn("flex-1 truncate", hidden && "text-muted-foreground/50")}>
                  {resolveLabel(k)}
                </span>
                <button
                  className={cn(
                    "text-[10px] hover:underline",
                    frozenExtras.length >= 3
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "text-muted-foreground",
                  )}
                  onClick={() => toggleFrozen(k)}
                  disabled={frozenExtras.length >= 3}
                  title={frozenExtras.length >= 3 ? "최대 3개까지 고정 가능" : "왼쪽 고정"}
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