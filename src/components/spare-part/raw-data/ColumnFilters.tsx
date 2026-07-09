import { useMemo } from "react";
import type { Column } from "@tanstack/react-table";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { EMPTY_TOKEN } from "@/lib/spare-part/filters";
import type { SparePartFilterType } from "@/lib/spare-part/columns";

function TriggerButton({ isActive, onClick }: { isActive: boolean; onClick?: (e: any) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
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
}

function MultiSelectDropdown({ column }: { column: Column<any, unknown> }) {
  const selected: string[] = (column.getFilterValue() as string[]) ?? [];
  const isActive = selected.length > 0;
  const facets = column.getFacetedUniqueValues?.() as Map<any, number> | undefined;

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

  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    column.setFilterValue(next.length ? next : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <TriggerButton isActive={isActive} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-72 w-56 overflow-auto p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2 px-1">
          <button
            className="text-[11px] text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(items.map((o) => o.value))}
          >
            Select all
          </button>
          <button
            className="text-[11px] text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear all
          </button>
        </div>
        {items.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50",
              opt.count === 0 && !selected.includes(opt.value) && "text-muted-foreground/60",
            )}
          >
            <Checkbox
              checked={selected.includes(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
              className="h-3.5 w-3.5"
            />
            <span className="flex-1 truncate">{opt.value === EMPTY_TOKEN ? "(Empty)" : opt.value}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{opt.count}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function TextFilterDropdown({ column }: { column: Column<any, unknown> }) {
  const fv = column.getFilterValue() as { text?: string; emptyOnly?: boolean } | undefined;
  const text = fv?.text ?? "";
  const emptyOnly = fv?.emptyOnly ?? false;
  const isActive = !!(text || emptyOnly);
  const update = (patch: Partial<{ text: string; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.text || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <TriggerButton isActive={isActive} />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-52 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-1">
          <button
            className="text-[11px] text-muted-foreground hover:underline"
            onClick={() => column.setFilterValue(undefined)}
          >
            Clear all
          </button>
        </div>
        <Input
          placeholder="Search... (, for AND)"
          value={text}
          onChange={(e) => update({ text: e.target.value || undefined })}
          className="h-7 text-xs"
          disabled={emptyOnly}
        />
        <p className="text-[10px] text-muted-foreground">Tip: comma = AND</p>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={emptyOnly}
            onCheckedChange={(c) => update({ emptyOnly: !!c, text: undefined })}
            className="h-3.5 w-3.5"
          />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

function DateRangeDropdown({ column }: { column: Column<any, unknown> }) {
  const fv = column.getFilterValue() as { from?: string; to?: string; emptyOnly?: boolean } | undefined;
  const isActive = !!(fv?.from || fv?.to || fv?.emptyOnly);
  const update = (patch: Partial<{ from: string; to: string; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.from || next.to || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <TriggerButton isActive={isActive} />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <button
          className="text-[11px] text-muted-foreground hover:underline"
          onClick={() => column.setFilterValue(undefined)}
        >
          Clear all
        </button>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">From</label>
          <Input
            type="date"
            value={fv?.from ?? ""}
            onChange={(e) => update({ from: e.target.value || undefined })}
            className="h-7 text-xs"
            disabled={!!fv?.emptyOnly}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">To</label>
          <Input
            type="date"
            value={fv?.to ?? ""}
            onChange={(e) => update({ to: e.target.value || undefined })}
            className="h-7 text-xs"
            disabled={!!fv?.emptyOnly}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Checkbox
            checked={!!fv?.emptyOnly}
            onCheckedChange={(c) => update({ emptyOnly: !!c, from: undefined, to: undefined })}
            className="h-3.5 w-3.5"
          />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

function NumberRangeDropdown({ column }: { column: Column<any, unknown> }) {
  const fv = column.getFilterValue() as { min?: number; max?: number; emptyOnly?: boolean } | undefined;
  const isActive = fv?.min != null || fv?.max != null || !!fv?.emptyOnly;
  const update = (patch: Partial<{ min: number | undefined; max: number | undefined; emptyOnly: boolean }>) => {
    const next = { ...(fv ?? {}), ...patch };
    column.setFilterValue(next.min != null || next.max != null || next.emptyOnly ? next : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <TriggerButton isActive={isActive} />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-52 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <button
          className="text-[11px] text-muted-foreground hover:underline"
          onClick={() => column.setFilterValue(undefined)}
        >
          Clear all
        </button>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Min</label>
          <Input
            type="number"
            value={fv?.min ?? ""}
            onChange={(e) => update({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="h-7 text-xs"
            disabled={!!fv?.emptyOnly}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Max</label>
          <Input
            type="number"
            value={fv?.max ?? ""}
            onChange={(e) => update({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="h-7 text-xs"
            disabled={!!fv?.emptyOnly}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Checkbox
            checked={!!fv?.emptyOnly}
            onCheckedChange={(c) => update({ emptyOnly: !!c, min: undefined, max: undefined })}
            className="h-3.5 w-3.5"
          />
          Empty only
        </label>
      </PopoverContent>
    </Popover>
  );
}

function BooleanDropdown({ column }: { column: Column<any, unknown> }) {
  const fv = (column.getFilterValue() as string) ?? "all";
  const isActive = fv !== "all" && fv !== undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <TriggerButton isActive={isActive} />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-44 space-y-1 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        {[
          ["all", "All"],
          ["true", "Yes"],
          ["false", "No"],
          ["empty", "(Empty)"],
        ].map(([val, label]) => (
          <label key={val} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
            <input
              type="radio"
              checked={fv === val}
              onChange={() => column.setFilterValue(val === "all" ? undefined : val)}
              className="h-3 w-3"
            />
            {label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ColumnFilterDropdown({ column, filterType }: { column: Column<any, unknown>; filterType: SparePartFilterType }) {
  if (filterType === "multi-select") return <MultiSelectDropdown column={column} />;
  if (filterType === "date-range") return <DateRangeDropdown column={column} />;
  if (filterType === "number-range") return <NumberRangeDropdown column={column} />;
  if (filterType === "boolean") return <BooleanDropdown column={column} />;
  return <TextFilterDropdown column={column} />;
}