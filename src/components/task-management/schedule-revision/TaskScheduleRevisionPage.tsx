import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { CalendarClock, Columns3, Filter, Pin, PinOff, RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Stage = "plan_start" | "plan_end" | "forecast_end";
type FilterKind = "text" | "date-range" | "multi-select";

type FilterMeta = {
  filterType?: FilterKind;
  filterOptions?: { value: string; label: string }[];
};

interface ScheduleChangeAudit {
  id: string;
  created_at: string;
  created_by: string | null;
  raw_row_no: number | null;
  source_file: string | null;
  task_raw_id: string | null;
  task_no: string;
  main_task_no: string | null;
  discipline: string | null;
  team: string | null;
  plot: string | null;
  task_name: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  plan_start_old_date: string | null;
  plan_start_new_date: string | null;
  plan_start_diff_days: number | null;
  plan_start_prev_gap_days: number | null;
  plan_start_cur_gap_days: number | null;
  plan_end_old_date: string | null;
  plan_end_new_date: string | null;
  plan_end_diff_days: number | null;
  plan_end_prev_gap_days: number | null;
  plan_end_cur_gap_days: number | null;
  forecast_end_old_date: string | null;
  forecast_end_new_date: string | null;
  forecast_end_diff_days: number | null;
  forecast_end_prev_gap_days: number | null;
}

type Row = ScheduleChangeAudit;

const stageGroups: Stage[] = ["plan_start", "plan_end", "forecast_end"];
const stageLabels: Record<Stage, string> = {
  plan_start: "Plan Start",
  plan_end: "Plan End",
  forecast_end: "Forecast End",
};
const stageHasSuccessor: Record<Stage, boolean> = {
  plan_start: true,
  plan_end: true,
  forecast_end: false,
};
const EMPTY_TOKEN = "__EMPTY__";
const STORAGE_KEY = "tm.schedule-revision.view.v1";

// 좌측 flat 컬럼 (핀 가능)
const FLAT_COLUMNS: { id: string; label: string; size: number }[] = [
  { id: "created_at", label: "Changed At", size: 140 },
  { id: "source_file", label: "Source File", size: 220 },
  { id: "discipline", label: "Discipline", size: 110 },
  { id: "team", label: "Team", size: 90 },
  { id: "plot", label: "Plot", size: 90 },
  { id: "task_no", label: "Task No", size: 130 },
  { id: "main_task_no", label: "Main Task", size: 130 },
  { id: "task_name", label: "Task Name", size: 260 },
  { id: "hdec_pic_name", label: "HDEC PIC", size: 110 },
  { id: "hdec_eng_name", label: "HDEC ENG", size: 110 },
];

function stageLeafIds(stage: Stage): { id: string; label: string; size: number }[] {
  const base = [
    { id: `${stage}_old_date`, label: "Old", size: 90 },
    { id: `${stage}_new_date`, label: "New", size: 90 },
    { id: `${stage}_diff_days`, label: "Diff", size: 70 },
    { id: `${stage}_prev_gap_days`, label: "Prev.Gap", size: 80 },
  ];
  if (stageHasSuccessor[stage]) {
    base.push({ id: `${stage}_cur_gap_days`, label: "Cur.Gap", size: 80 });
  }
  return base;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDdMmm(v: string | null | undefined): string {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const mo = Number(m[2]);
  return `${m[3]}-${MONTHS[mo - 1] ?? m[2]}`;
}
function formatDateTimeDdMmmYyyy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = MONTHS[d.getMonth()];
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yy} ${hh}:${mi}`;
}
function formatSignedDays(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v > 0) return `+${v}`;
  return String(v);
}
const formatGap = (v: number | null | undefined) => (v == null ? "—" : String(v));
const diffClass = (v: number | null) =>
  v == null ? "" : v > 0 ? "text-destructive font-medium" : v < 0 ? "text-primary font-medium" : "text-muted-foreground";

const textFilterFn = (row: any, columnId: string, filterValue: { text?: string; emptyOnly?: boolean } | string | undefined) => {
  if (!filterValue) return true;
  const text = typeof filterValue === "string" ? filterValue : filterValue.text;
  const emptyOnly = typeof filterValue === "object" ? filterValue.emptyOnly : false;
  const value = row.getValue(columnId);
  if (emptyOnly) return value == null || String(value).trim() === "";
  if (!text) return true;
  if (value == null) return false;
  return String(value).toLowerCase().includes(text.toLowerCase());
};
const dateRangeFilterFn = (row: any, columnId: string, filterValue: { from?: string; to?: string; emptyOnly?: boolean } | undefined) => {
  if (!filterValue) return true;
  const { from, to, emptyOnly } = filterValue;
  const rawValue = row.getValue(columnId) as string | null;
  if (emptyOnly) return rawValue == null || rawValue === "";
  if (!from && !to) return true;
  if (!rawValue) return false;
  const value = String(rawValue).slice(0, 10);
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
};
const multiSelectFilterFn = (row: any, columnId: string, filterValue: string[] | undefined) => {
  if (!filterValue?.length) return true;
  const value = row.getValue(columnId);
  const isEmpty = value == null || value === "";
  if (filterValue.includes(EMPTY_TOKEN) && isEmpty) return true;
  if (isEmpty) return false;
  return filterValue.includes(String(value));
};

// ── Pin/size 유틸 ─────────────────────────────
function pinStyle(column: Column<Row>, isHeader = false): CSSProperties {
  const isPinned = column.getIsPinned() === "left";
  if (!isPinned) return { width: column.getSize(), minWidth: column.getSize() };
  return {
    position: "sticky",
    left: column.getStart("left"),
    zIndex: isHeader ? 30 : 20,
    width: column.getSize(),
    minWidth: column.getSize(),
    background: "hsl(var(--background))",
    boxShadow: "inset -1px 0 0 hsl(var(--border))",
  };
}

function ResizeHandle({ column }: { column: Column<Row> }) {
  const onDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = column.getSize();
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(50, startW + ev.clientX - startX);
      (column as any).setSize?.(w);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return (
    <span
      onMouseDown={onDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none bg-transparent hover:bg-primary/50"
    />
  );
}

function StageCells({ row, stage, table }: { row: Row; stage: Stage; table: ReturnType<typeof useReactTable<Row>> }) {
  const leaves = stageLeafIds(stage);
  return (
    <>
      {leaves.map((leaf, idx) => {
        const column = table.getColumn(leaf.id);
        if (!column || !column.getIsVisible()) return null;
        const value = row[leaf.id as keyof Row];
        let content: React.ReactNode = "—";
        let cls = "text-xs whitespace-nowrap";
        if (leaf.id.endsWith("_old_date") || leaf.id.endsWith("_new_date")) {
          content = formatDdMmm(value as string | null);
        } else if (leaf.id.endsWith("_diff_days")) {
          const v = value as number | null;
          content = formatSignedDays(v);
          cls = cn("text-xs text-right", diffClass(v));
        } else {
          content = formatGap(value as number | null);
          cls = "text-xs text-right";
        }
        return (
          <TableCell key={leaf.id} className={cn(cls, idx === 0 && "border-l")} style={{ width: column.getSize(), minWidth: column.getSize() }}>
            {content}
          </TableCell>
        );
      })}
    </>
  );
}

function TextFilterDropdown({ column }: { column: Column<Row> }) {
  const filterValue = column.getFilterValue() as { text?: string; emptyOnly?: boolean } | string | undefined;
  const text = typeof filterValue === "string" ? filterValue : filterValue?.text ?? "";
  const emptyOnly = typeof filterValue === "object" ? filterValue?.emptyOnly ?? false : false;
  const isActive = Boolean(text || emptyOnly);
  const update = (patch: Partial<{ text: string; emptyOnly: boolean }>) => {
    const current = typeof filterValue === "string" ? { text: filterValue, emptyOnly: false } : filterValue ?? { text: "", emptyOnly: false };
    const next = { ...current, ...patch };
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
        <Input
          placeholder="Search..."
          value={text}
          onChange={(e) => update({ text: e.target.value || undefined })}
          className="h-7 text-xs"
          disabled={emptyOnly}
        />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, text: undefined })} className="h-3.5 w-3.5" />
          Empty only
        </label>
        <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>
          Clear
        </button>
      </PopoverContent>
    </Popover>
  );
}

function DateRangeDropdown({ column }: { column: Column<Row> }) {
  const filterValue = column.getFilterValue() as { from?: string; to?: string; emptyOnly?: boolean } | undefined;
  const isActive = Boolean(filterValue?.from || filterValue?.to || filterValue?.emptyOnly);
  const update = (patch: Partial<{ from: string; to: string; emptyOnly: boolean }>) => {
    const next = { ...(filterValue ?? {}), ...patch };
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
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">From</label>
          <Input type="date" value={filterValue?.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} className="h-7 text-xs" disabled={!!filterValue?.emptyOnly} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">To</label>
          <Input type="date" value={filterValue?.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} className="h-7 text-xs" disabled={!!filterValue?.emptyOnly} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={!!filterValue?.emptyOnly} onCheckedChange={(c) => update({ emptyOnly: !!c, from: undefined, to: undefined })} className="h-3.5 w-3.5" />
          Empty only
        </label>
        <button className="text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>
          Clear
        </button>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectDropdown({ column, options }: { column: Column<Row>; options: { value: string; label: string }[] }) {
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const isActive = selected.length > 0;
  const allOptions = [{ value: EMPTY_TOKEN, label: "(Empty)" }, ...options];
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((i) => i !== value) : [...selected, value];
    column.setFilterValue(next.length ? next : undefined);
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
      <PopoverContent className="max-h-60 w-52 overflow-auto p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <button className="mb-1 px-1 text-[11px] text-muted-foreground hover:underline" onClick={() => column.setFilterValue(undefined)}>
          Clear all
        </button>
        {allOptions.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
            <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} className="h-3.5 w-3.5" />
            {option.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ColumnFilterDropdown({ column }: { column: Column<Row> }) {
  const meta = column.columnDef.meta as FilterMeta | undefined;
  if (meta?.filterType === "date-range") return <DateRangeDropdown column={column} />;
  if (meta?.filterType === "multi-select") return <MultiSelectDropdown column={column} options={meta.filterOptions ?? []} />;
  return <TextFilterDropdown column={column} />;
}

function SortableHeader({
  column, label, className, rowSpan, pinnable = false,
}: {
  column: Column<Row> | undefined;
  label: string;
  className?: string;
  rowSpan?: number;
  pinnable?: boolean;
}) {
  if (!column) {
    return <TableHead rowSpan={rowSpan} className={cn("relative text-xs whitespace-nowrap", className)}>{label}</TableHead>;
  }
  const sorted = column.getIsSorted();
  const style = pinStyle(column, true);
  const isPinned = column.getIsPinned() === "left";
  return (
    <TableHead
      rowSpan={rowSpan}
      className={cn("relative text-xs whitespace-nowrap bg-background", className)}
      style={style}
    >
      <div className="flex items-center gap-1 pr-2">
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={column.getToggleSortingHandler()}>
          <span>{label}</span>
          <span className="w-2 text-[10px] text-muted-foreground">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
        </button>
        {column.getCanFilter() && <ColumnFilterDropdown column={column} />}
        {pinnable && (
          <button
            className={cn("inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted/80", isPinned ? "text-primary" : "text-muted-foreground/40")}
            title={isPinned ? "Unpin" : "Pin left"}
            onClick={(e) => {
              e.stopPropagation();
              column.pin(isPinned ? false : "left");
            }}
          >
            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
        )}
      </div>
      <ResizeHandle column={column} />
    </TableHead>
  );
}

function ColumnsMenu({ table }: { table: ReturnType<typeof useReactTable<Row>> }) {
  const allLeafFlat = FLAT_COLUMNS;
  const stageLeaves = stageGroups.map((s) => ({ stage: s, leaves: stageLeafIds(s) }));
  const resetAll = () => {
    table.resetColumnVisibility();
    table.resetColumnSizing();
    table.setColumnPinning({ left: [], right: [] });
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium">컬럼 표시 / 고정</span>
          <button className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={resetAll}>
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        <div className="max-h-[420px] space-y-3 overflow-auto">
          <div>
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Left · Pinnable</div>
            {allLeafFlat.map((c) => {
              const col = table.getColumn(c.id);
              if (!col) return null;
              const visible = col.getIsVisible();
              const pinned = col.getIsPinned() === "left";
              return (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted/50">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={visible} onCheckedChange={(v) => col.toggleVisibility(!!v)} className="h-3.5 w-3.5" />
                    {c.label}
                  </label>
                  <button
                    className={cn("inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted", pinned ? "text-primary" : "text-muted-foreground/50")}
                    onClick={() => col.pin(pinned ? false : "left")}
                    title={pinned ? "Unpin" : "Pin left"}
                  >
                    {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}
          </div>
          {stageLeaves.map(({ stage, leaves }) => (
            <div key={stage}>
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{stageLabels[stage]}</div>
              {leaves.map((c) => {
                const col = table.getColumn(c.id);
                if (!col) return null;
                return (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
                    <Checkbox checked={col.getIsVisible()} onCheckedChange={(v) => col.toggleVisibility(!!v)} className="h-3.5 w-3.5" />
                    {c.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const RECENT_LIMIT = 500;

export function TaskScheduleRevisionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [], right: [] });
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load prefs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.columnSizing) setColumnSizing(parsed.columnSizing);
        if (parsed.columnVisibility) setColumnVisibility(parsed.columnVisibility);
        if (parsed.columnPinning) setColumnPinning(parsed.columnPinning);
      }
    } catch {}
    setPrefsLoaded(true);
  }, []);

  // Persist prefs
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ columnSizing, columnVisibility, columnPinning }),
      );
    } catch {}
  }, [prefsLoaded, columnSizing, columnVisibility, columnPinning]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("task_schedule_change_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);
      if (cancelled) return;
      setRows((data as Row[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const disciplineOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.discipline && set.add(r.discipline));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.team && set.add(r.team));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);
  const picOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.hdec_pic_name && set.add(r.hdec_pic_name));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const flatDefs: ColumnDef<Row>[] = FLAT_COLUMNS.map((c) => {
      const base: ColumnDef<Row> = { accessorKey: c.id, header: c.label, size: c.size, enableResizing: true };
      if (c.id === "created_at") return { ...base, filterFn: dateRangeFilterFn, meta: { filterType: "date-range" } };
      if (c.id === "discipline") return { ...base, filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: disciplineOptions } };
      if (c.id === "team") return { ...base, filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: teamOptions } };
      if (c.id === "hdec_pic_name") return { ...base, filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: picOptions } };
      return { ...base, filterFn: textFilterFn };
    });
    const stageDefs: ColumnDef<Row>[] = stageGroups.flatMap((stage) =>
      stageLeafIds(stage).map((leaf) => {
        const isDate = leaf.id.endsWith("_old_date") || leaf.id.endsWith("_new_date");
        return {
          accessorKey: leaf.id,
          header: leaf.label,
          size: leaf.size,
          enableResizing: true,
          filterFn: isDate ? dateRangeFilterFn : textFilterFn,
          meta: isDate ? { filterType: "date-range" as const } : undefined,
        };
      }),
    );
    return [...flatDefs, ...stageDefs];
  }, [disciplineOptions, teamOptions, picOptions]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility, columnPinning },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const countLabel = `${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()} revisions`;

  const visibleFlatCols = FLAT_COLUMNS.filter((c) => table.getColumn(c.id)?.getIsVisible());
  const stageVisibleLeaves = stageGroups.map((s) => stageLeafIds(s).filter((l) => table.getColumn(l.id)?.getIsVisible()));
  const totalColSpan = visibleFlatCols.length + stageVisibleLeaves.reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CalendarClock className="h-5 w-5 text-primary" />
            Schedule Revision
          </h1>
          <p className="text-xs text-muted-foreground">
            Plan Start / Plan End / Forecast End 계획 일자 변경 이력 · 최근 {RECENT_LIMIT}건 · {countLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {columnFilters.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setColumnFilters([])}>
              <X className="h-3.5 w-3.5" />
              Clear filters ({columnFilters.length})
            </Button>
          )}
          {sorting.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSorting([])}>
              Clear sort
            </Button>
          )}
          <ColumnsMenu table={table} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <Skeleton className="h-[520px] w-full" />
            </div>
          ) : (
            <div className="max-h-[680px] overflow-auto rounded-md border-0">
              <Table style={{ width: table.getTotalSize(), minWidth: "100%" }}>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {visibleFlatCols.map((c) => (
                      <SortableHeader key={c.id} column={table.getColumn(c.id)} label={c.label} rowSpan={2} pinnable />
                    ))}
                    {stageGroups.map((stage, idx) => {
                      const span = stageVisibleLeaves[idx].length;
                      if (span === 0) return null;
                      return (
                        <TableHead key={stage} colSpan={span} className="border-l text-center text-xs">
                          {stageLabels[stage]}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                  <TableRow>
                    {stageGroups.flatMap((stage, sIdx) =>
                      stageVisibleLeaves[sIdx].map((leaf, leafIdx) => (
                        <SortableHeader
                          key={`${stage}-${leaf.id}`}
                          column={table.getColumn(leaf.id)}
                          label={leaf.label}
                          className={leafIdx === 0 ? "border-l" : ""}
                        />
                      )),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={totalColSpan} className="py-8 text-center text-muted-foreground">
                        변경 이력이 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleRows.map((r) => {
                      const o = r.original;
                      return (
                        <TableRow key={o.id}>
                          {visibleFlatCols.map((c) => {
                            const col = table.getColumn(c.id)!;
                            const style = pinStyle(col, false);
                            let content: React.ReactNode = "—";
                            let cls = "text-xs";
                            const value = (o as any)[c.id];
                            if (c.id === "created_at") {
                              content = formatDateTimeDdMmmYyyy(o.created_at);
                              cls = "text-xs whitespace-nowrap";
                            } else if (c.id === "source_file") {
                              content = value ?? "—";
                              cls = "text-xs whitespace-nowrap truncate";
                            } else if (c.id === "task_no") {
                              content = value ?? "—";
                              cls = "text-xs font-medium";
                            } else if (c.id === "task_name") {
                              content = value ?? "—";
                              cls = "text-xs truncate";
                            } else {
                              content = value ?? "—";
                              cls = "text-xs whitespace-nowrap";
                            }
                            return (
                              <TableCell key={c.id} className={cls} style={style} title={typeof value === "string" ? value : undefined}>
                                {content}
                              </TableCell>
                            );
                          })}
                          {stageGroups.map((stage) => (
                            <StageCells key={stage} row={o} stage={stage} table={table} />
                          ))}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}