import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  /** 후보값 — 필터 적용 전 원본 행에서 뽑은 distinct */
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

const BLANK = "(blank)";

export function SplColumnFilterDropdown({ label, values, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    return values.filter((v) => !t || (v || BLANK).toLowerCase().includes(t));
  }, [values, q]);

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
          <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px]" onClick={() => onChange(options)}>
            Select all
          </Button>
          <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px]" onClick={() => onChange([])}>
            Clear all
          </Button>
        </div>
        <div className="max-h-60 space-y-1 overflow-auto">
          {options.length === 0 && <div className="p-2 text-[11px] text-muted-foreground">No values</div>}
          {options.map((v) => (
            <label key={v || "__blank__"} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted">
              <Checkbox checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
              <span className={cn("truncate", !v && "italic text-muted-foreground")}>{v || BLANK}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}