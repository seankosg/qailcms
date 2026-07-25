import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight } from "lucide-react";

export type RowListTab = "today" | "risk" | "upcoming" | "all";

export interface RowColumn<T> {
  key: string;
  label: string;
  width?: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: RowColumn<T>[];
  activeTab: RowListTab;
  onTabChange: (t: RowListTab) => void;
  counts: { today: number; all: number; risk: number; upcoming: number };
  filterRow: (row: T, tab: RowListTab) => boolean;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  rowKey: (row: T) => string;
  order?: string[];
  visibility?: Record<string, boolean>;
  frozen?: string[];
  toolbarExtra?: ReactNode;
  defaultCollapsed?: boolean;
}

export function ModuleRowList<T>({
  rows, columns, activeTab, onTabChange, counts, filterRow, onRowClick, emptyText = "표시할 항목이 없습니다.", rowKey,
  order, visibility, frozen, toolbarExtra, defaultCollapsed = true,
}: Props<T>) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const filtered = useMemo(() => rows.filter((r) => filterRow(r, activeTab)), [rows, activeTab, filterRow]);
  const orderedCols = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const fro = frozen ?? [];
    const ord = order ?? columns.map((c) => c.key);
    const vis = visibility ?? {};
    const seen = new Set<string>();
    const out: RowColumn<T>[] = [];
    for (const k of fro) {
      const c = byKey.get(k);
      if (c && !seen.has(k)) { out.push(c); seen.add(k); }
    }
    for (const k of ord) {
      if (seen.has(k)) continue;
      if (vis[k] === false) continue;
      const c = byKey.get(k);
      if (c) { out.push(c); seen.add(k); }
    }
    // 정의에 있지만 order 목록에서 누락된 컬럼은 뒤에 append (신규 추가된 컬럼 안전 렌더)
    for (const c of columns) {
      if (seen.has(c.key)) continue;
      if (vis[c.key] === false) continue;
      out.push(c);
      seen.add(c.key);
    }
    return out;
  }, [columns, order, visibility, frozen]);

  // sticky offset 계산: frozen 컬럼들의 누적 left 값
  const frozenKeys = new Set(frozen ?? []);
  const offsets = new Map<string, number>();
  let acc = 0;
  for (const c of orderedCols) {
    if (!frozenKeys.has(c.key)) break;
    offsets.set(c.key, acc);
    const w = c.width ? parseInt(c.width, 10) : 100;
    acc += Number.isFinite(w) ? w : 100;
  }

  const frozenCellClass = "sticky z-[1] [background:linear-gradient(hsl(var(--card)),hsl(var(--card))),linear-gradient(hsl(var(--card)),hsl(var(--card)))]";
  const frozenHeadClass = "sticky z-[2] [background:linear-gradient(hsl(var(--muted)/.6),hsl(var(--muted)/.6)),linear-gradient(hsl(var(--background)),hsl(var(--background)))]";

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={collapsed ? "펼치기" : "접기"}
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent text-muted-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <Tabs value={activeTab} onValueChange={(v) => { onTabChange(v as RowListTab); setCollapsed(false); }}>
            <TabsList className="h-8">
              <TabsTrigger value="today" className="text-xs h-7 px-2.5">오늘 ({counts.today.toLocaleString()})</TabsTrigger>
              <TabsTrigger value="risk" className="text-xs h-7 px-2.5">지연 ({counts.risk.toLocaleString()})</TabsTrigger>
              <TabsTrigger value="upcoming" className="text-xs h-7 px-2.5">임박 ({counts.upcoming.toLocaleString()})</TabsTrigger>
              <TabsTrigger value="all" className="text-xs h-7 px-2.5">전체 ({counts.all.toLocaleString()})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {filtered.length.toLocaleString()} 건
          </div>
          {toolbarExtra}
        </div>
      </div>
      {!collapsed && (
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
            <tr>
              {orderedCols.map((c) => {
                const isFrozen = frozenKeys.has(c.key);
                const left = offsets.get(c.key);
                return (
                  <th
                    key={c.key}
                    className={cn(
                      "text-left font-medium text-muted-foreground px-2 py-1.5 whitespace-nowrap",
                      isFrozen && frozenHeadClass,
                      c.className,
                    )}
                    style={{ width: c.width, left: isFrozen ? left : undefined }}
                  >
                    {c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={orderedCols.length} className="px-3 py-6 text-center text-muted-foreground">{emptyText}</td></tr>
            ) : filtered.map((r) => (
              <tr
                key={rowKey(r)}
                className={cn("border-t hover:bg-accent/40 transition", onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {orderedCols.map((c) => {
                  const isFrozen = frozenKeys.has(c.key);
                  const left = offsets.get(c.key);
                  return (
                    <td
                      key={c.key}
                      className={cn("px-2 py-1.5 align-middle", isFrozen && frozenCellClass, c.className)}
                      style={{ left: isFrozen ? left : undefined }}
                    >
                      {c.render(r)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
