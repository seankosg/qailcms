import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TOC 컬럼 필터 드롭다운.
 * SM(`src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx`)의 마크업·동작을 그대로 따르며,
 * 값 목록(패싯)만 서버 RPC 대신 현재 조회 결과에서 산출한 값을 props 로 받는다(교차 필터 동일).
 */
export const EMPTY_TOKEN = "__EMPTY__";

export type FacetItem = { value: string; count: number };

function MultiSelectDropdown({
  column,
  facet,
}: {
  column: any;
  facet: FacetItem[];
}) {
  const selected: string[] = (column.getFilterValue() as string[]) ?? [];
  const isActive = selected.length > 0;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    column.setFilterValue(next.length ? next : undefined);
  };

  const items = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of facet) counts.set(f.value, f.count);
    for (const v of selected) if (!counts.has(v)) counts.set(v, 0);
    const empty = counts.get(EMPTY_TOKEN) ?? 0;
    counts.delete(EMPTY_TOKEN);
    const list = [...counts.entries()].map(([value, count]) => ({ value, label: value, count }));
    list.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label, undefined, { sensitivity: "base" })));
    const emptyVisible = empty > 0 || selected.includes(EMPTY_TOKEN);
    return emptyVisible ? [{ value: EMPTY_TOKEN, label: "(Empty)", count: empty }, ...list] : list;
  }, [facet, selected]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")}
          onClick={(e) => e.stopPropagation()}
          title="Filter"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색..." className="mb-1 h-7 text-xs" />
        <div className="mb-1 flex items-center gap-2 px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(filteredItems.map((o) => o.value))}>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear all</button>
        </div>
        <div className="max-h-64 overflow-auto">
          {filteredItems.length === 0 && (
            <div className="py-4 text-center text-[11px] text-muted-foreground">일치하는 값 없음</div>
          )}
          {filteredItems.map((option) => (
            <label
              key={option.value}
              className={cn("flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50", option.count === 0 && "text-muted-foreground/60")}
            >
              <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} className="h-3.5 w-3.5" />
              <span className="flex-1 truncate">
                {option.value === EMPTY_TOKEN ? <em className="text-muted-foreground">(Empty)</em> : option.label}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{option.count}</span>
            </label>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 border-t px-1 pt-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(filteredItems.map((o) => o.value))}>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TextFilterDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as { text?: string; emptyOnly?: boolean } | string | undefined;
  const text = typeof fv === "string" ? fv : fv?.text ?? "";
  const emptyOnly = typeof fv === "object" ? fv?.emptyOnly ?? false : false;
  const isActive = !!(text || emptyOnly);
  const update = (patch: Partial<{ text: string; emptyOnly: boolean }>) => {
    const cur = typeof fv === "string" ? { text: fv, emptyOnly: false } : fv ?? { text: "", emptyOnly: false };
    const next = { ...cur, ...patch };
    column.setFilterValue(next.text || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")}
          onClick={(e) => e.stopPropagation()}
          title="Filter"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <button className="cursor-not-allowed text-[11px] text-muted-foreground/40" disabled>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear all</button>
        </div>
        <Input placeholder="Search... (use , for AND)" value={text} onChange={(e) => update({ text: e.target.value || undefined })} className="h-7 text-xs" disabled={emptyOnly} />
        <p className="text-[10px] text-muted-foreground">Tip: comma separates AND terms</p>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, text: undefined })} className="h-3.5 w-3.5" />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

function DateRangeDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as { from?: string; to?: string; emptyOnly?: boolean } | undefined;
  const isActive = !!(fv?.from || fv?.to || fv?.emptyOnly);
  const update = (patch: Partial<{ from: string; to: string; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.from || next.to || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")}
          onClick={(e) => e.stopPropagation()}
          title="Filter"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <button className="cursor-not-allowed text-[11px] text-muted-foreground/40" disabled>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear all</button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">From</label>
          <Input type="date" value={fv?.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} className="h-7 text-xs" disabled={!!fv?.emptyOnly} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">To</label>
          <Input type="date" value={fv?.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} className="h-7 text-xs" disabled={!!fv?.emptyOnly} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Checkbox checked={!!fv?.emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, from: undefined, to: undefined })} className="h-3.5 w-3.5" />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

export function TocColumnFilterDropdown({
  column,
  facet,
}: {
  column: any;
  facet: FacetItem[];
}) {
  const meta = (column.columnDef.meta ?? {}) as { filterType?: string };
  if (meta.filterType === "date-range") return <DateRangeDropdown column={column} />;
  if (meta.filterType === "text") return <TextFilterDropdown column={column} />;
  return <MultiSelectDropdown column={column} facet={facet} />;
}
