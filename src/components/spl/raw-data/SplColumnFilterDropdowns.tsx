import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SplFacetOption {
  value: string;
  count: number;
}

interface Props {
  label: string;
  /**
   * 크로스필터 후보값 — "이 컬럼을 제외한" 다른 모든 필터를 적용한 행에서 산출한다.
   * 팝오버가 열릴 때만 호출되도록 지연 평가한다(SM Raw Data 와 동일 규칙).
   */
  getOptions: () => SplFacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

const BLANK = "(blank)";

export function SplColumnFilterDropdown({ label, getOptions, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  // 열릴 때 한 번 산출 — 닫힌 컬럼까지 매 렌더 계산하지 않는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const facets = useMemo(() => (open ? getOptions() : []), [open]);

  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    return facets.filter((o) => !t || (o.value || BLANK).toLowerCase().includes(t));
  }, [facets, q]);

  const active = selected.length > 0;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Filter: ${label}`}
          className={cn(
            "ml-1 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted-foreground/20",
            active ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium">{label}</span>
          {active && (
            <Button size="sm" variant="ghost" className="h-6 px-1 text-[10px]" onClick={() => onChange([])}>
              <X className="mr-0.5 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search values"
          className="mb-2 h-7 text-xs"
        />
        <div className="mb-1 flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 flex-1 text-[10px]"
            onClick={() => onChange(options.map((o) => o.value))}
          >
            Select all
          </Button>
          <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px]" onClick={() => onChange([])}>
            Clear all
          </Button>
        </div>
        <div className="max-h-60 space-y-1 overflow-auto">
          {options.length === 0 && <div className="p-2 text-[11px] text-muted-foreground">No values</div>}
          {options.map((o) => (
            <label
              key={o.value || "__blank__"}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted",
                o.count === 0 && "text-muted-foreground/60",
              )}
            >
              <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className={cn("flex-1 truncate", !o.value && "italic text-muted-foreground")}>
                {o.value || BLANK}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{o.count}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}