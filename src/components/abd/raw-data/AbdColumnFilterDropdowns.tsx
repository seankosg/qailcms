import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_TOKEN } from "@/lib/abd/filter-fns";
import { useAbdFacet, type AbdStatusGroup, type AbdTeam, type AbdServerFilter } from "@/hooks/useAbdItems";
import { useAbdDataDate } from "@/hooks/useAbdDataDate";

export function AbdMultiSelectDropdown({
  column,
  options,
  q,
  serverFilters,
}: {
  column: any;
  options: { value: string; label: string }[];
  q?: string;
  serverFilters?: AbdServerFilter[];
}) {
  const selected: string[] = (column.getFilterValue() as string[]) ?? [];
  const isActive = selected.length > 0;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const meta = (column.columnDef.meta ?? {}) as any;
  const serverFacetCol: string | null = meta.serverFacet ?? null;
  const team: AbdTeam = (meta.team as AbdTeam) ?? "MECH";
  const statusGroup: AbdStatusGroup = (meta.statusGroup as AbdStatusGroup) ?? "all";
  const includeInactive: boolean = !!meta.includeInactive;
  const plot: "C" | "D" | null = (meta.plot as "C" | "D" | null) ?? null;
  // 크로스 필터링: props로 부모의 최신 검색어/서버 필터를 받아 자기 자신은 훅에서 제외.
  const activeFilters: AbdServerFilter[] = serverFilters ?? [];
  const [asOf] = useAbdDataDate();
  const { data: serverFacet, isFetching: facetLoading } = useAbdFacet(open ? serverFacetCol : null, {
    team,
    statusGroup,
    includeInactive,
    plot,
    q,
    filters: activeFilters,
    asOf: asOf || null,
    enabled: open && !!serverFacetCol,
  });
  const labelMap = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  // TM 크로스필터 정합: 서버 facet가 반환한 값만 노출 + 이미 선택된 값은 카운트 0이어도 유지.
  // (Empty)는 서버가 카운트 > 0일 때만 자동 노출(마이그레이션에서 __EMPTY__ 로 반환), 선택된 경우도 유지.
  const items = useMemo(() => {
    const counts = new Map<string, number>();
    if (serverFacet?.length) for (const f of serverFacet) counts.set(f.value, f.cnt);
    // 이미 선택된 값이 현재 facet에 없으면 카운트 0으로 유지 노출 (선택 해제 UX 위해)
    for (const v of selected) if (!counts.has(v)) counts.set(v, 0);
    const empty = counts.get(EMPTY_TOKEN) ?? 0;
    counts.delete(EMPTY_TOKEN);
    const list = [...counts.entries()].map(([value, count]) => ({
      value,
      label: labelMap.get(value) ?? value,
      count,
    }));
    // TM 동일: count desc → label asc
    list.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    const emptyVisible = empty > 0 || selected.includes(EMPTY_TOKEN);
    return emptyVisible
      ? [{ value: EMPTY_TOKEN, label: "(Empty)", count: empty }, ...list]
      : list;
  }, [serverFacet, labelMap, selected]);
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, query]);
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    column.setFilterValue(next.length ? next : undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")} onClick={(e) => e.stopPropagation()} title="Filter">
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
        {facetLoading && filteredItems.length === 0 && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">로딩 중...</div>
        )}
        {!facetLoading && filteredItems.length === 0 && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">일치하는 값 없음</div>
        )}
        {filteredItems.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50",
              option.count === 0 && "text-muted-foreground/60",
            )}
          >
            <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} className="h-3.5 w-3.5" />
            <span className="flex-1 truncate">
              {option.value === EMPTY_TOKEN
                ? <em className="text-muted-foreground">(Empty)</em>
                : option.label}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{option.count}</span>
          </label>
        ))}
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 border-t pt-1 px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(filteredItems.map((o) => o.value))}>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AbdTextFilterDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as { text?: string; emptyOnly?: boolean } | undefined;
  const text = fv?.text ?? "";
  const emptyOnly = !!fv?.emptyOnly;
  const isActive = !!(text || emptyOnly);
  const update = (patch: Partial<{ text: string; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.text || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")} onClick={(e) => e.stopPropagation()} title="Filter">
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear all</button>
        </div>
        <Input placeholder="Search... (use , for AND)" value={text} onChange={(e) => update({ text: e.target.value || undefined })} className="h-7 text-xs" disabled={emptyOnly} />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, text: undefined })} className="h-3.5 w-3.5" /> Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

export function AbdDateRangeDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as { from?: string; to?: string; emptyOnly?: boolean } | undefined;
  const isActive = !!(fv?.from || fv?.to || fv?.emptyOnly);
  const update = (patch: Partial<{ from: string; to: string; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.from || next.to || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isActive ? "text-primary" : "text-muted-foreground/50")} onClick={(e) => e.stopPropagation()} title="Filter">
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
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
          <Checkbox checked={!!fv?.emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, from: undefined, to: undefined })} className="h-3.5 w-3.5" /> Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

export function AbdColumnFilterDropdown({
  column,
  q,
  serverFilters,
}: {
  column: any;
  q?: string;
  serverFilters?: AbdServerFilter[];
}) {
  const meta = column.columnDef.meta as any;
  if (meta?.filterType === "multi-select")
    return <AbdMultiSelectDropdown column={column} options={meta.filterOptions ?? []} q={q} serverFilters={serverFilters} />;
  if (meta?.filterType === "date-range") return <AbdDateRangeDropdown column={column} />;
  if (meta?.filterType === "number-range") return <AbdNumberRangeDropdown column={column} />;
  return <AbdTextFilterDropdown column={column} />;
}

export function AbdNumberRangeDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as
    | { min?: number | null; max?: number | null; emptyOnly?: boolean }
    | undefined;
  const isActive = fv?.min != null || fv?.max != null || !!fv?.emptyOnly;
  const update = (
    patch: Partial<{ min: number | null; max: number | null; emptyOnly: boolean }>,
  ) => {
    const next = { ...(fv ?? {}), ...patch };
    const hasAny =
      next.min != null || next.max != null || next.emptyOnly === true;
    column.setFilterValue(hasAny ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80",
            isActive ? "text-primary" : "text-muted-foreground/50",
          )}
          onClick={(e) => e.stopPropagation()}
          title="Filter"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 space-y-2 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-1">
          <button
            className="text-[11px] text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear all
          </button>
        </div>
        <div className="flex gap-1.5">
          <Input
            type="number"
            value={fv?.min ?? ""}
            placeholder="Min"
            disabled={!!fv?.emptyOnly}
            onChange={(e) =>
              update({ min: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="h-7 text-xs"
          />
          <Input
            type="number"
            value={fv?.max ?? ""}
            placeholder="Max"
            disabled={!!fv?.emptyOnly}
            onChange={(e) =>
              update({ max: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="h-7 text-xs"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Checkbox
            checked={!!fv?.emptyOnly}
            onCheckedChange={(c) => update({ emptyOnly: !!c, min: null, max: null })}
            className="h-3.5 w-3.5"
          />{" "}
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}