import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Columns3,
  Filter,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APPROVAL_CODE_COLORS,
  PLOT_COLORS,
  SPARE_PART_COLUMNS,
  formatDdMmm,
  formatNumber,
} from "@/lib/spare-part/columns";

type Row = Record<string, unknown> & { doc_ref: string; plot: string };

const LS_KEY = "qail.spare-part.raw-data.v1";

interface PersistedState {
  sorting: SortingState;
  sizing: ColumnSizingState;
  visibility: VisibilityState;
  approvalCodes: string[];
  plots: string[];
  onlyDuplicate: boolean;
  onlyActive: boolean;
}

function loadState(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : {};
  } catch {
    return {};
  }
}

function saveState(s: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // noop
  }
}

export function SparePartRawDataPage() {
  const persisted = useMemo(loadState, []);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sorting, setSorting] = useState<SortingState>(persisted.sorting ?? []);
  const [sizing, setSizing] = useState<ColumnSizingState>(persisted.sizing ?? {});
  const [visibility, setVisibility] = useState<VisibilityState>(persisted.visibility ?? {});
  const [approvalCodes, setApprovalCodes] = useState<string[]>(persisted.approvalCodes ?? []);
  const [plots, setPlots] = useState<string[]>(persisted.plots ?? []);
  const [onlyDuplicate, setOnlyDuplicate] = useState<boolean>(persisted.onlyDuplicate ?? false);
  const [onlyActive, setOnlyActive] = useState<boolean>(persisted.onlyActive ?? true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveState({ sorting, sizing, visibility, approvalCodes, plots, onlyDuplicate, onlyActive });
  }, [sorting, sizing, visibility, approvalCodes, plots, onlyDuplicate, onlyActive]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["spare-parts-raw"],
    queryFn: async () => {
      const selectCols = ["doc_ref", "plot", "is_active", ...SPARE_PART_COLUMNS.map((c) => c.key)];
      const unique = Array.from(new Set(selectCols));
      const { data, error } = await supabase
        .from("spare_parts_raw")
        .select(unique.join(","))
        .order("doc_ref", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  const approvalFacet = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = String(r.approval_code ?? "").trim() || "—";
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const plotFacet = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = String(r.plot ?? "").trim() || "—";
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (onlyActive && r.is_active === false) return false;
      if (onlyDuplicate && r.is_duplicate !== true) return false;
      if (approvalCodes.length > 0) {
        const code = String(r.approval_code ?? "").trim() || "—";
        if (!approvalCodes.includes(code)) return false;
      }
      if (plots.length > 0) {
        const p = String(r.plot ?? "").trim() || "—";
        if (!plots.includes(p)) return false;
      }
      if (debounced) {
        const hay = [r.doc_ref, r.subject, r.supplier, r.manufacturer, r.category, r.system_type, r.po_number]
          .map((v) => String(v ?? "").toLowerCase())
          .join(" ");
        if (!hay.includes(debounced)) return false;
      }
      return true;
    });
  }, [rows, debounced, approvalCodes, plots, onlyDuplicate, onlyActive]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    return SPARE_PART_COLUMNS.map((c) => ({
      id: c.key,
      accessorKey: c.key,
      header: c.label,
      size: c.width,
      minSize: 60,
      maxSize: 480,
      enableSorting: true,
      sortingFn: c.type === "number" || c.type === "cost" || c.type === "progress"
        ? "basic"
        : c.type === "date"
        ? (a, b, id) => {
            const av = a.getValue<string | null>(id);
            const bv = b.getValue<string | null>(id);
            const at = av ? new Date(av).getTime() : 0;
            const bt = bv ? new Date(bv).getTime() : 0;
            return at - bt;
          }
        : "alphanumeric",
      cell: ({ getValue }) => renderCell(c.key, getValue()),
    }));
  }, []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnSizing: sizing, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnSizingChange: setSizing,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    enableMultiSort: true,
  });

  const virtRef = useRef<HTMLDivElement>(null);
  const rowModel = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => virtRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  const totalWidth = table.getTotalSize();

  const resetAll = () => {
    setSorting([]);
    setSizing({});
    setVisibility({});
    setApprovalCodes([]);
    setPlots([]);
    setOnlyDuplicate(false);
    setOnlyActive(true);
    setSearch("");
  };

  const activeFilters =
    (approvalCodes.length > 0 ? 1 : 0) +
    (plots.length > 0 ? 1 : 0) +
    (onlyDuplicate ? 1 : 0) +
    (!onlyActive ? 1 : 0) +
    (debounced ? 1 : 0);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Spare Part — Raw Data</h1>
        <Badge variant="secondary" className="ml-2">
          {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} rows
        </Badge>
        {isFetching && <span className="text-xs text-muted-foreground">불러오는 중…</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="doc_ref / subject / supplier…"
              className="h-8 w-64 pl-7"
            />
          </div>

          <MultiSelectDropdown
            label="Approval"
            options={approvalFacet}
            selected={approvalCodes}
            onChange={setApprovalCodes}
          />
          <MultiSelectDropdown label="Plot" options={plotFacet} selected={plots} onChange={setPlots} />

          <Button
            variant={onlyDuplicate ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setOnlyDuplicate((v) => !v)}
          >
            DP only
          </Button>
          <Button
            variant={onlyActive ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setOnlyActive((v) => !v)}
          >
            Active only
          </Button>

          <ColumnVisibilityMenu
            visibility={visibility}
            onChange={setVisibility}
          />

          <Button variant="outline" size="sm" className="h-8" onClick={resetAll}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {activeFilters > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {approvalCodes.map((c) => (
            <FilterChip key={`ac-${c}`} label={`Approval: ${c}`} onClear={() => setApprovalCodes((s) => s.filter((x) => x !== c))} />
          ))}
          {plots.map((p) => (
            <FilterChip key={`p-${p}`} label={`Plot: ${p}`} onClear={() => setPlots((s) => s.filter((x) => x !== p))} />
          ))}
          {onlyDuplicate && <FilterChip label="DP only" onClear={() => setOnlyDuplicate(false)} />}
          {!onlyActive && <FilterChip label="Including inactive" onClear={() => setOnlyActive(true)} />}
          {debounced && <FilterChip label={`Search: ${debounced}`} onClear={() => setSearch("")} />}
        </div>
      )}

      {/* Table container */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <div ref={virtRef} className="h-full overflow-auto">
          <div style={{ width: totalWidth }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-10 flex border-b bg-muted/70 backdrop-blur">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  return (
                    <div
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className="relative flex select-none items-center gap-1 border-r px-2 py-1.5 text-xs font-medium"
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="flex flex-1 items-center gap-1 truncate text-left"
                        title={String(h.column.columnDef.header ?? "")}
                      >
                        <span className="truncate">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </span>
                        {sort === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : sort === "desc" ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </button>
                      <div
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-primary/40",
                          h.column.getIsResizing() && "bg-primary",
                        )}
                      />
                    </div>
                  );
                }),
              )}
            </div>

            {/* Virtualized body */}
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((vRow) => {
                const row = rowModel.rows[vRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.id}
                    style={{
                      transform: `translateY(${vRow.start}px)`,
                      height: vRow.size,
                      width: totalWidth,
                    }}
                    className="absolute left-0 top-0 flex border-b text-xs hover:bg-accent/40"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="flex items-center overflow-hidden truncate border-r px-2"
                        title={stringifyForTitle(cell.getValue())}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {rowModel.rows.length === 0 && !isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                일치하는 행이 없습니다.
              </div>
            )}
            {isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                로딩 중…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function stringifyForTitle(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function renderCell(key: string, raw: unknown) {
  const col = SPARE_PART_COLUMNS.find((c) => c.key === key);
  if (!col) return <span>{stringifyForTitle(raw)}</span>;

  if (raw == null || raw === "") return <span className="text-muted-foreground/50">—</span>;

  if (col.type === "badge" && key === "approval_code") {
    const code = String(raw);
    const cls = APPROVAL_CODE_COLORS[code] ?? "bg-muted text-foreground";
    return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{code}</span>;
  }
  if (col.type === "badge" && key === "plot") {
    const p = String(raw);
    const cls = PLOT_COLORS[p] ?? "bg-muted text-foreground";
    return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{p}</span>;
  }
  if (col.type === "boolean") {
    return raw === true ? (
      <Check className="h-3.5 w-3.5 text-emerald-600" />
    ) : raw === false ? (
      <X className="h-3.5 w-3.5 text-rose-500/70" />
    ) : (
      <span className="text-muted-foreground/50">—</span>
    );
  }
  if (col.type === "date") {
    return <span className="tabular-nums">{formatDdMmm(String(raw))}</span>;
  }
  if (col.type === "number") {
    return <span className="tabular-nums">{formatNumber(Number(raw))}</span>;
  }
  if (col.type === "cost") {
    return <span className="tabular-nums">{formatNumber(Number(raw), 2)}</span>;
  }
  if (col.type === "progress") {
    const n = Math.max(0, Math.min(1, Number(raw) || 0));
    return (
      <div className="flex w-full items-center gap-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary" style={{ width: `${n * 100}%` }} />
        </div>
        <span className="w-8 text-right text-[10px] tabular-nums">{Math.round(n * 100)}%</span>
      </div>
    );
  }
  return <span className="truncate">{String(raw)}</span>;
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
        aria-label="Clear filter"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<[string, number]>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {selected.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">값 없음</div>
        )}
        {options.map(([val, count]) => {
          const isChecked = selected.includes(val);
          return (
            <DropdownMenuCheckboxItem
              key={val}
              checked={isChecked}
              onCheckedChange={(c) => {
                onChange(c ? [...selected, val] : selected.filter((x) => x !== val));
              }}
              onSelect={(e) => e.preventDefault()}
              className="text-xs"
            >
              <span className="flex-1 truncate">{val}</span>
              <span className="ml-2 text-muted-foreground">{count}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onSelect={() => onChange([])}>
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnVisibilityMenu({
  visibility,
  onChange,
}: {
  visibility: VisibilityState;
  onChange: (v: VisibilityState) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Column visibility</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SPARE_PART_COLUMNS.map((c) => {
          const hidden = visibility[c.key] === false;
          return (
            <DropdownMenuItem
              key={c.key}
              className="text-xs"
              onSelect={(e) => {
                e.preventDefault();
                onChange({ ...visibility, [c.key]: hidden });
              }}
            >
              <Checkbox checked={!hidden} className="mr-2 h-3 w-3" />
              <span className="flex-1 truncate">{c.label}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">{c.group}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={() => onChange({})}>
          Show all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}