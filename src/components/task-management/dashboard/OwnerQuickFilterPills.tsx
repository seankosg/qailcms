import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PillProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}

function OwnerPill({ label, options, value, onChange }: PillProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.toLowerCase().includes(qq));
  }, [options, q]);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1 px-2 text-xs", value.length > 0 && "border-primary text-primary")}>
          <span className="font-medium">{label}</span>
          {value.length > 0 ? (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums">
              {value.length}
            </span>
          ) : (
            <span className="text-muted-foreground">All</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="mb-2 flex items-center gap-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색..."
            className="h-7 text-xs"
          />
          {value.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onChange([])}
              aria-label="선택 초기화"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="max-h-64 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-2 text-center text-xs text-muted-foreground">항목 없음</div>
          ) : (
            filtered.map((o) => {
              const selected = value.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-accent",
                    selected && "bg-accent",
                  )}
                >
                  <span className="truncate">{o}</span>
                  {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  teamOptions: string[];
  picOptions: string[];
  engOptions: string[];
  team: string[];
  hdecPic: string[];
  hdecEng: string[];
  onChange: (v: { team?: string[]; hdecPic?: string[]; hdecEng?: string[] }) => void;
}

export function OwnerQuickFilterPills({
  teamOptions,
  picOptions,
  engOptions,
  team,
  hdecPic,
  hdecEng,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        담당자 축
      </span>
      <OwnerPill label="Team" options={teamOptions} value={team} onChange={(v) => onChange({ team: v })} />
      <OwnerPill label="HDEC PIC" options={picOptions} value={hdecPic} onChange={(v) => onChange({ hdecPic: v })} />
      <OwnerPill label="HDEC ENG" options={engOptions} value={hdecEng} onChange={(v) => onChange({ hdecEng: v })} />
    </div>
  );
}