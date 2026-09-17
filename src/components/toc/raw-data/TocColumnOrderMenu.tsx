import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, GripVertical, Pin, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOC_COLUMNS } from "@/lib/toc/columns";

/**
 * TOC 컬럼 순서·노출·고정 메뉴.
 * SM(`DefectColumnOrderMenu.tsx`)의 UI·동작을 그대로 따르되, TOC 는 필드 설정 표가 없어
 * 관리자 라벨 편집·서버 순서 저장은 제공하지 않는다(계정별 화면설정에만 저장).
 */
interface Props {
  order: string[];
  visibility: Record<string, boolean>;
  frozenExtras: string[];
  defaultOrder: string[];
  onOrderChange: (next: string[]) => void;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  onFrozenChange: (next: string[]) => void;
  onSaveLayout?: () => void;
}

const LABEL = new Map(TOC_COLUMNS.map((c) => [c.key, c.label] as const));
const MAX_FROZEN = 3;

export function TocColumnOrderMenu({
  order,
  visibility,
  frozenExtras,
  defaultOrder,
  onOrderChange,
  onVisibilityChange,
  onFrozenChange,
  onSaveLayout,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const resolveLabel = (k: string) => LABEL.get(k) ?? k;

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = [...order];
    const fi = next.indexOf(from);
    const ti = next.indexOf(to);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1);
    next.splice(ti, 0, from);
    onOrderChange(next);
  };

  const toggleVisible = (k: string) => {
    const nextVisible = visibility[k] === false;
    onVisibilityChange({ ...visibility, [k]: nextVisible });
  };

  const togglePin = (k: string) => {
    if (frozenExtras.includes(k)) {
      onFrozenChange(frozenExtras.filter((x) => x !== k));
      return;
    }
    if (frozenExtras.length >= MAX_FROZEN) return;
    onFrozenChange([...frozenExtras, k]);
    // 고정 컬럼은 항상 노출
    if (visibility[k] === false) onVisibilityChange({ ...visibility, [k]: true });
  };

  const hiddenCount = order.filter((k) => visibility[k] === false).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-1 h-3.5 w-3.5" /> Columns
          {hiddenCount > 0 ? ` (${order.length - hiddenCount}/${order.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium">Order · Visibility · Pin (max {MAX_FROZEN})</span>
          <div className="flex items-center gap-1">
            {onSaveLayout && (
              <Button variant="ghost" size="sm" className="h-6 px-1 text-[11px]" onClick={onSaveLayout}>
                <Save className="mr-1 h-3 w-3" /> Save
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-[11px]"
              onClick={() => {
                onOrderChange(defaultOrder);
                onVisibilityChange({});
                onFrozenChange([]);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] space-y-0.5 overflow-auto">
          {order.map((k) => {
            const pinned = frozenExtras.includes(k);
            return (
              <div
                key={k}
                draggable
                onDragStart={() => setDragKey(k)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragKey) move(dragKey, k);
                  setDragKey(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-muted/60",
                  dragKey === k && "opacity-50",
                )}
              >
                <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground/60" />
                <Checkbox
                  checked={visibility[k] !== false}
                  onCheckedChange={() => toggleVisible(k)}
                  className="h-3.5 w-3.5"
                  disabled={pinned}
                />
                <span className="flex-1 truncate">{resolveLabel(k)}</span>
                <button
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted",
                    pinned ? "text-primary" : "text-muted-foreground/50",
                  )}
                  title={pinned ? "Unpin" : frozenExtras.length >= MAX_FROZEN ? `Max ${MAX_FROZEN} pinned` : "Pin to left"}
                  onClick={() => togglePin(k)}
                >
                  <Pin className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
