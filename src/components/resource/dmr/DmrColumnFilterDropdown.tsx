import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EMPTY_TOKEN, useDmrFacet, type DmrScope, type DmrServerFilter } from '@/hooks/useDmrEntries';

function MultiSelect({
  column,
  options,
  scope,
  q,
  serverFilters,
}: {
  column: any;
  options: { value: string; label: string }[];
  scope?: DmrScope;
  q?: string;
  serverFilters?: DmrServerFilter[];
}) {
  const selected: string[] = (column.getFilterValue() as string[]) ?? [];
  const isActive = selected.length > 0;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const meta = (column.columnDef.meta ?? {}) as any;
  const facetCol: string | null = meta.serverFacet ?? null;
  const { data: facet, isFetching: facetLoading } = useDmrFacet(open ? facetCol : null, {
    enabled: open && !!facetCol,
    scope,
    filters: serverFilters ?? [],
    q,
  });
  // 서버 facet 가 없는 컬럼(정적 옵션 보유 가상 컬럼)은 meta.filterOptions 를 그대로 노출
  const staticOnly = !facetCol && options.length > 0;
  const labelMap = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);

  // 크로스필터 정합(SM/TM/ABD 동일): 서버 facet 가 반환한 값만 노출.
  // 이미 선택된 값은 카운트 0 이어도 해제 UX 위해 유지. (Empty)는 카운트>0 또는 선택 시에만 노출.
  const items = useMemo(() => {
    if (staticOnly) {
      return options.map((o) => ({ value: o.value, label: o.label, count: -1 }));
    }
    const counts = new Map<string, number>();
    if (facet?.length) for (const f of facet) counts.set(f.value, f.cnt);
    for (const v of selected) if (!counts.has(v)) counts.set(v, 0);
    const empty = counts.get(EMPTY_TOKEN) ?? 0;
    counts.delete(EMPTY_TOKEN);
    const list = [...counts.entries()].map(([value, count]) => ({
      value,
      label: labelMap.get(value) ?? value,
      count,
    }));
    list.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
    const emptyVisible = empty > 0 || selected.includes(EMPTY_TOKEN);
    return emptyVisible ? [{ value: EMPTY_TOKEN, label: '(Empty)', count: empty }, ...list] : list;
  }, [facet, labelMap, selected, staticOnly, options]);
  const filtered = useMemo(() => {
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
        <button
          className={cn('inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80', isActive ? 'text-primary' : 'text-muted-foreground/50')}
          onClick={(e) => e.stopPropagation()}
          title="Filter"
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색..." className="mb-1 h-7 text-xs" />
        <div className="mb-1 flex items-center gap-2 px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(filtered.map((o) => o.value))}>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear all</button>
        </div>
        <div className="max-h-64 overflow-auto">
          {facetLoading && !staticOnly && filtered.length === 0 && (
            <div className="py-4 text-center text-[11px] text-muted-foreground">로딩 중...</div>
          )}
          {(!facetLoading || staticOnly) && filtered.length === 0 && (
            <div className="py-4 text-center text-[11px] text-muted-foreground">일치하는 값 없음</div>
          )}
          {filtered.map((option) => (
            <label
              key={option.value}
              className={cn('flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50', option.count === 0 && !selected.includes(option.value) && 'text-muted-foreground/60')}
            >
              <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} className="h-3.5 w-3.5" />
              <span className="flex-1 truncate">
                {option.value === EMPTY_TOKEN ? <em className="text-muted-foreground">(Empty)</em> : option.label}
              </span>
              {option.count >= 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{option.count}</span>
              )}
            </label>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 border-t pt-1 px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(filtered.map((o) => o.value))}>Select all</button>
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TextDropdown({ column }: { column: any }) {
  const fv = column.getFilterValue() as { text?: string; emptyOnly?: boolean } | string | undefined;
  const text = typeof fv === 'string' ? fv : fv?.text ?? '';
  const emptyOnly = typeof fv === 'object' ? fv?.emptyOnly ?? false : false;
  const isActive = !!(text || emptyOnly);
  const update = (patch: Partial<{ text: string; emptyOnly: boolean }>) => {
    const cur = typeof fv === 'string' ? { text: fv, emptyOnly: false } : fv ?? { text: '', emptyOnly: false };
    const next = { ...cur, ...patch };
    column.setFilterValue(next.text || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn('inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80', isActive ? 'text-primary' : 'text-muted-foreground/50')}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
        <Input placeholder="Search... (use , for AND)" value={text} onChange={(e) => update({ text: e.target.value || undefined })} className="h-7 text-xs" disabled={emptyOnly} />
        <p className="text-[10px] text-muted-foreground">Tip: 쉼표로 AND 조건 (예: <code>slab, rebar</code>)</p>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, text: undefined })} className="h-3.5 w-3.5" />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

function DateRange({ column }: { column: any }) {
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
          className={cn('inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80', isActive ? 'text-primary' : 'text-muted-foreground/50')}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">From</label>
          <Input type="date" value={fv?.from ?? ''} onChange={(e) => update({ from: e.target.value || undefined })} className="h-7 text-xs" disabled={!!fv?.emptyOnly} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">To</label>
          <Input type="date" value={fv?.to ?? ''} onChange={(e) => update({ to: e.target.value || undefined })} className="h-7 text-xs" disabled={!!fv?.emptyOnly} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NumRange({ column }: { column: any }) {
  const fv = column.getFilterValue() as { min?: string; max?: string } | undefined;
  const isActive = !!(fv?.min || fv?.max);
  const update = (patch: Partial<{ min: string; max: string }>) => {
    const next = { ...(fv ?? {}), ...patch };
    const hasVal = (next.min != null && next.min !== '') || (next.max != null && next.max !== '');
    column.setFilterValue(hasVal ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn('inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80', isActive ? 'text-primary' : 'text-muted-foreground/50')}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end px-1">
          <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>Clear</button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Min</label>
          <Input type="number" value={fv?.min ?? ''} onChange={(e) => update({ min: e.target.value })} className="h-7 text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Max</label>
          <Input type="number" value={fv?.max ?? ''} onChange={(e) => update({ max: e.target.value })} className="h-7 text-xs" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DmrColumnFilterDropdown({ column, scope }: { column: any; scope?: DmrScope }) {
  const meta = (column.columnDef.meta ?? {}) as any;
  const t = meta.filterType ?? 'text';
  if (t === 'multi-select') return <MultiSelect column={column} options={meta.filterOptions ?? []} scope={scope} />;
  if (t === 'date-range') return <DateRange column={column} />;
  if (t === 'number-range') return <NumRange column={column} />;
  return <TextDropdown column={column} />;
}