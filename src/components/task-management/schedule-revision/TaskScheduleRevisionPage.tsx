import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { CalendarClock, Filter, X } from "lucide-react";
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

function StageCells({ row, stage }: { row: Row; stage: Stage }) {
  const oldDate = row[`${stage}_old_date` as keyof Row] as string | null;
  const newDate = row[`${stage}_new_date` as keyof Row] as string | null;
  const diff = row[`${stage}_diff_days` as keyof Row] as number | null;
  const prevGap = row[`${stage}_prev_gap_days` as keyof Row] as number | null;
  const curGap = stageHasSuccessor[stage]
    ? (row[`${stage}_cur_gap_days` as keyof Row] as number | null)
    : null;
  return (
    <>
      <TableCell className="text-xs whitespace-nowrap border-l">{formatDdMmm(oldDate)}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">{formatDdMmm(newDate)}</TableCell>
      <TableCell className={cn("text-xs text-right", diffClass(diff))}>{formatSignedDays(diff)}</TableCell>
      <TableCell className="text-xs text-right">{formatGap(prevGap)}</TableCell>
      {stageHasSuccessor[stage] && <TableCell className="text-xs text-right">{formatGap(curGap)}</TableCell>}
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

function SortableHeader({ column, label, className, rowSpan }: { column: Column<Row> | undefined; label: string; className?: string; rowSpan?: number }) {
  if (!column) return <TableHead rowSpan={rowSpan} className={cn("text-xs whitespace-nowrap", className)}>{label}</TableHead>;
  const sorted = column.getIsSorted();
  return (
    <TableHead rowSpan={rowSpan} className={cn("text-xs whitespace-nowrap", className)}>
      <div className="flex items-center gap-1">
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={column.getToggleSortingHandler()}>
          <span>{label}</span>
          <span className="w-2 text-[10px] text-muted-foreground">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
        </button>
        {column.getCanFilter() && <ColumnFilterDropdown column={column} />}
      </div>
    </TableHead>
  );
}

const RECENT_LIMIT = 500;

export function TaskScheduleRevisionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

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

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: "created_at", header: "Changed At", filterFn: dateRangeFilterFn, meta: { filterType: "date-range" } },
    { accessorKey: "source_file", header: "Source File", filterFn: textFilterFn },
    { accessorKey: "discipline", header: "Discipline", filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: disciplineOptions } },
    { accessorKey: "team", header: "Team", filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: teamOptions } },
    { accessorKey: "plot", header: "Plot", filterFn: textFilterFn },
    { accessorKey: "task_no", header: "Task No", filterFn: textFilterFn },
    { accessorKey: "main_task_no", header: "Main Task", filterFn: textFilterFn },
    { accessorKey: "task_name", header: "Task Name", filterFn: textFilterFn },
    { accessorKey: "hdec_pic_name", header: "HDEC PIC", filterFn: multiSelectFilterFn, meta: { filterType: "multi-select", filterOptions: picOptions } },
    { accessorKey: "hdec_eng_name", header: "HDEC ENG", filterFn: textFilterFn },
    ...stageGroups.flatMap((stage) => {
      const cols: ColumnDef<Row>[] = [
        { accessorKey: `${stage}_old_date`, header: `${stageLabels[stage]} Old`, filterFn: dateRangeFilterFn, meta: { filterType: "date-range" } },
        { accessorKey: `${stage}_new_date`, header: `${stageLabels[stage]} New`, filterFn: dateRangeFilterFn, meta: { filterType: "date-range" } },
        { accessorKey: `${stage}_diff_days`, header: `${stageLabels[stage]} Diff`, filterFn: textFilterFn },
        { accessorKey: `${stage}_prev_gap_days`, header: `${stageLabels[stage]} Prev.Gap`, filterFn: textFilterFn },
      ];
      if (stageHasSuccessor[stage]) {
        cols.push({ accessorKey: `${stage}_cur_gap_days`, header: `${stageLabels[stage]} Cur.Gap`, filterFn: textFilterFn });
      }
      return cols;
    }),
  ], [disciplineOptions, teamOptions, picOptions]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const countLabel = `${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()} revisions`;
  const totalColSpan = 10 + stageGroups.reduce((n, s) => n + (stageHasSuccessor[s] ? 5 : 4), 0);

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
              <Table className="min-w-[2400px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <SortableHeader column={table.getColumn("created_at")} label="Changed At" rowSpan={2} />
                    <SortableHeader column={table.getColumn("source_file")} label="Source File" rowSpan={2} />
                    <SortableHeader column={table.getColumn("discipline")} label="Discipline" rowSpan={2} />
                    <SortableHeader column={table.getColumn("team")} label="Team" rowSpan={2} />
                    <SortableHeader column={table.getColumn("plot")} label="Plot" rowSpan={2} />
                    <SortableHeader column={table.getColumn("task_no")} label="Task No" rowSpan={2} />
                    <SortableHeader column={table.getColumn("main_task_no")} label="Main Task" rowSpan={2} />
                    <SortableHeader column={table.getColumn("task_name")} label="Task Name" rowSpan={2} />
                    <SortableHeader column={table.getColumn("hdec_pic_name")} label="HDEC PIC" rowSpan={2} />
                    <SortableHeader column={table.getColumn("hdec_eng_name")} label="HDEC ENG" rowSpan={2} />
                    {stageGroups.map((stage) => (
                      <TableHead key={stage} colSpan={stageHasSuccessor[stage] ? 5 : 4} className="border-l text-center text-xs">
                        {stageLabels[stage]}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {stageGroups.flatMap((stage) => {
                      const suffixes = stageHasSuccessor[stage]
                        ? ["old_date", "new_date", "diff_days", "prev_gap_days", "cur_gap_days"]
                        : ["old_date", "new_date", "diff_days", "prev_gap_days"];
                      const labels = ["Old", "New", "Diff", "Prev.Gap", "Cur.Gap"];
                      return suffixes.map((suffix, index) => (
                        <SortableHeader
                          key={`${stage}-${suffix}`}
                          column={table.getColumn(`${stage}_${suffix}`)}
                          label={labels[index]}
                          className="border-l first:border-l-0"
                        />
                      ));
                    })}
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
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTimeDdMmmYyyy(o.created_at)}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap max-w-[220px] truncate" title={o.source_file ?? ""}>{o.source_file ?? "—"}</TableCell>
                          <TableCell className="text-xs">{o.discipline ?? "—"}</TableCell>
                          <TableCell className="text-xs">{o.team ?? "—"}</TableCell>
                          <TableCell className="text-xs">{o.plot ?? "—"}</TableCell>
                          <TableCell className="text-xs font-medium">{o.task_no}</TableCell>
                          <TableCell className="text-xs">{o.main_task_no ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[260px] truncate" title={o.task_name ?? ""}>{o.task_name ?? "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{o.hdec_pic_name ?? "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{o.hdec_eng_name ?? "—"}</TableCell>
                          {stageGroups.map((stage) => (
                            <StageCells key={stage} row={o} stage={stage} />
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