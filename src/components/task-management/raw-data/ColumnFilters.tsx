import { useMemo, useState } from "react";
import type { Column } from "@tanstack/react-table";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { EMPTY_TOKEN } from "@/lib/task-management/filters";
import type { TmFilterType } from "@/lib/task-management/columns";

const TriggerButton = ({
  isActive,
  ...props
}: { isActive: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    onClick={(e) => {
      e.stopPropagation();
      props.onClick?.(e);
    }}
    onPointerDown={(e) => {
      e.stopPropagation();
      props.onPointerDown?.(e);
    }}
    className={cn(
      "inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80",
      isActive ? "text-primary" : "text-muted-foreground/50",
    )}
    title="Filter"
  >
    <Filter className="h-3 w-3" />
  </button>
);

function MultiSelectDropdown({ column }: { column: Column<any, unknown> }) {
  const selected: string[] = (column.getFilterValue() as string[]) ?? [];
  const isActive = selected.length > 0;
  const facets = column.getFacetedUniqueValues?.() as Map<any, number> | undefined;
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const counts = new Map<string, number>();
    let emptyCount = 0;
    if (facets) {
      facets.forEach((count, val) => {
        if (val == null || val === "") emptyCount += count;
        else counts.set(String(val), (counts.get(String(val)) ?? 0) + count);
      });
    }
    selected.forEach((v) => {
      if (v !== EMPTY_TOKEN && !counts.has(v)) counts.set(v, 0);
    });
    const list = [...counts.entries()].map(([value, count]) => ({ value, count }));
    list.sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: "base" }));
    return [{ value: EMPTY_TOKEN, count: emptyCount }, ...list];
  }, [facets, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.value === EMPTY_TOKEN ? "(empty)".includes(q) : it.value.toLowerCase().includes(q),
    );
  }, [items, query]);

  const toggle = (v: string) => {
    const cur = new Set(selected);
    if (cur.has(v)) cur.delete(v);
    else cur.add(v);
    const next = Array.from(cur);
    column.setFilterValue(next.length ? next : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton isActive={isActive} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색"
          className="mb-1 h-7 text-xs"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="max-h-60 overflow-y-auto">
          {filtered.map((it) => (
            <label
              key={it.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent/50"
            >
              <Checkbox
                checked={selected.includes(it.value)}
                onCheckedChange={() => toggle(it.value)}
                className="h-3.5 w-3.5"
              />
              <span className="flex-1">
                {it.value === EMPTY_TOKEN ? <em className="text-muted-foreground">(Empty)</em> : it.value}
              </span>
              <span className="text-[10px] text-muted-foreground">{it.count}</span>
            </label>
          ))}
        </div>
        {isActive && (
          <button
            className="mt-1 w-full text-xs text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TextDropdown({ column }: { column: Column<any, unknown> }) {
  const val = (column.getFilterValue() as any) ?? { text: "", emptyOnly: false };
  const isActive = !!(val.text || val.emptyOnly);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton isActive={isActive} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 space-y-1.5">
        <Input
          value={val.text ?? ""}
          onChange={(e) => column.setFilterValue({ text: e.target.value, emptyOnly: val.emptyOnly })}
          placeholder="포함 (콤마=AND)"
          className="h-7 text-xs"
        />
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={!!val.emptyOnly}
            onCheckedChange={(v) => column.setFilterValue({ text: val.text, emptyOnly: !!v })}
            className="h-3.5 w-3.5"
          />
          비어있는 값만
        </label>
        {isActive && (
          <button
            className="w-full text-xs text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DateRangeDropdown({ column }: { column: Column<any, unknown> }) {
  const val = (column.getFilterValue() as any) ?? {};
  const isActive = !!(val.from || val.to || val.emptyOnly);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton isActive={isActive} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-8">From</span>
          <Input
            type="date"
            value={val.from ?? ""}
            onChange={(e) => column.setFilterValue({ ...val, from: e.target.value })}
            className="h-7 flex-1 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-8">To</span>
          <Input
            type="date"
            value={val.to ?? ""}
            onChange={(e) => column.setFilterValue({ ...val, to: e.target.value })}
            className="h-7 flex-1 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={!!val.emptyOnly}
            onCheckedChange={(v) => column.setFilterValue({ ...val, emptyOnly: !!v })}
            className="h-3.5 w-3.5"
          />
          비어있는 값만
        </label>
        {isActive && (
          <button
            className="w-full text-xs text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NumberRangeDropdown({ column }: { column: Column<any, unknown> }) {
  const val = (column.getFilterValue() as any) ?? {};
  const isActive = val.min != null || val.max != null || val.emptyOnly;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton isActive={isActive} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        <div className="flex gap-1.5">
          <Input
            type="number"
            value={val.min ?? ""}
            placeholder="Min"
            onChange={(e) =>
              column.setFilterValue({
                ...val,
                min: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="h-7 text-xs"
          />
          <Input
            type="number"
            value={val.max ?? ""}
            placeholder="Max"
            onChange={(e) =>
              column.setFilterValue({
                ...val,
                max: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="h-7 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={!!val.emptyOnly}
            onCheckedChange={(v) => column.setFilterValue({ ...val, emptyOnly: !!v })}
            className="h-3.5 w-3.5"
          />
          비어있는 값만
        </label>
        {isActive && (
          <button
            className="w-full text-xs text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ColumnFilterDropdown({
  column,
  filterType,
}: {
  column: Column<any, unknown>;
  filterType: TmFilterType;
}) {
  if (filterType === "multi-select") return <MultiSelectDropdown column={column} />;
  if (filterType === "text") return <TextDropdown column={column} />;
  if (filterType === "date-range") return <DateRangeDropdown column={column} />;
  if (filterType === "number-range") return <NumberRangeDropdown column={column} />;
  return null;
}