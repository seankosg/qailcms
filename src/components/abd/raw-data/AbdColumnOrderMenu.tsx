import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pencil, Pin, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { ABD_COLUMNS } from "@/lib/abd/columns";
import { useAbdFieldHelpers } from "@/hooks/useAbdFieldConfig";

interface Props {
  order: string[]; // full column order excluding system frozen
  visibility: Record<string, boolean>;
  frozenExtras: string[]; // 사용자 pin (__select 등 시스템 고정 뒤에 고정)
  defaultOrder?: string[];
  defaultVisibility?: Record<string, boolean>;
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
  isAdmin?: boolean;
  onServerReorder?: (patches: Array<{ field_key: string; sort_order: number }>) => void;
  onServerVisibility?: (field_key: string, visible: boolean) => void;
  onServerLabel?: (field_key: string, label: string) => void;
  /** 현재 컬럼 레이아웃(순서/노출/고정/너비)을 계정 설정으로 즉시 저장 */
  onSaveLayout?: () => void;
}

export function AbdColumnOrderMenu({
  order,
  visibility,
  frozenExtras,
  defaultOrder,
  defaultVisibility,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
  isAdmin,
  onServerReorder,
  onServerVisibility,
  onServerLabel,
  onSaveLayout,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const { getLabel } = useAbdFieldHelpers();

  const resolveLabel = (k: string): string => getLabel(k) ?? k;

  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReorderPersist = (nextOrder: string[]) => {
    if (!isAdmin || !onServerReorder) return;
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(() => {
      onServerReorder(nextOrder.map((k, i) => ({ field_key: k, sort_order: (i + 1) * 10 })));
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
    if (frozenExtras.includes(dragKey)) return;
    const next = [...order];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(k);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    onOrderChange(next);
    scheduleReorderPersist(next);
  };
  const onFrozenDragOver = (k: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragKey || dragKey === k) return;
    if (!frozenExtras.includes(dragKey) || !frozenExtras.includes(k)) return;
    const nextFrozen = [...frozenExtras];
    const from = nextFrozen.indexOf(dragKey);
    const to = nextFrozen.indexOf(k);
    if (from === -1 || to === -1) return;
    nextFrozen.splice(from, 1);
    nextFrozen.splice(to, 0, dragKey);
    onFrozenChange(nextFrozen);
    const nextOrder = [...nextFrozen, ...order.filter((x) => !nextFrozen.includes(x))];
    onOrderChange(nextOrder);
    scheduleReorderPersist(nextOrder);
  };
  const onDragEnd = () => setDragKey(null);

  const changeVisibility = (k: string, checked: boolean) => {
    onVisibilityChange({ ...visibility, [k]: checked });
    if (isAdmin && onServerVisibility) onServerVisibility(k, checked);
  };

  const startRename = (k: string) => {
    if (!isAdmin || !onServerLabel) return;
    setEditingKey(k);
    setEditingValue(resolveLabel(k));
  };
  const commitRename = () => {
    if (!editingKey) return;
    const next = editingValue.trim();
    const prev = resolveLabel(editingKey);
    if (next && next !== prev && onServerLabel) {
      onServerLabel(editingKey, next);
    }
    setEditingKey(null);
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
              onVisibilityChange(defaultVisibility ? { ...defaultVisibility } : {});
              onFrozenChange([]);
              onOrderChange(defaultOrder ?? ABD_COLUMNS.map((c) => c.key));
            }}
          >
            Reset
          </button>
        </div>
        {onSaveLayout ? (
          <div className="mb-2 px-1">
            <Button size="sm" className="h-7 w-full text-xs" onClick={() => onSaveLayout()}>
              <Save className="mr-1 h-3.5 w-3.5" />
              현재 컬럼 설정 저장
            </Button>
          </div>
        ) : null}
        <div className="max-h-80 overflow-y-auto pr-1">
          <div className="mb-1 rounded bg-muted/50 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Frozen · Select (고정)
          </div>
          {frozenExtras.map((k) => (
            <div
              key={k}
              draggable
              onDragStart={onDragStart(k)}
              onDragOver={onFrozenDragOver(k)}
              onDragEnd={onDragEnd}
              className={cn(
                "group flex cursor-move items-center gap-1 rounded px-1 py-1 text-xs hover:bg-muted/50",
                dragKey === k && "opacity-50",
              )}
            >
              <GripVertical className="h-3 w-3 text-muted-foreground/40" />
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
                {editingKey === k ? (
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      if (e.key === "Escape") { e.preventDefault(); setEditingKey(null); }
                    }}
                    className="flex-1 min-w-0 rounded border border-input bg-background px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <span className={cn("flex-1 truncate", hidden && "text-muted-foreground/50")}>
                    {resolveLabel(k)}
                  </span>
                )}
                {isAdmin && onServerLabel && editingKey !== k && (
                  <button
                    className="text-muted-foreground/60 hover:text-foreground"
                    onClick={() => startRename(k)}
                    title="라벨 이름 변경 (전체 사용자에 반영)"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
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