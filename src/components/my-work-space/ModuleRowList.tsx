import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type RowListTab = "all" | "risk" | "upcoming";

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
  counts: { all: number; risk: number; upcoming: number };
  filterRow: (row: T, tab: RowListTab) => boolean;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  rowKey: (row: T) => string;
}

export function ModuleRowList<T>({
  rows, columns, activeTab, onTabChange, counts, filterRow, onRowClick, emptyText = "표시할 항목이 없습니다.", rowKey,
}: Props<T>) {
  const filtered = useMemo(() => rows.filter((r) => filterRow(r, activeTab)), [rows, activeTab, filterRow]);
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as RowListTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-7 px-2.5">전체 ({counts.all.toLocaleString()})</TabsTrigger>
            <TabsTrigger value="risk" className="text-xs h-7 px-2.5">위험 ({counts.risk.toLocaleString()})</TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs h-7 px-2.5">임박 ({counts.upcoming.toLocaleString()})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="text-[11px] text-muted-foreground pr-1 tabular-nums">
          {filtered.length.toLocaleString()} 건
        </div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn("text-left font-medium text-muted-foreground px-2 py-1.5 whitespace-nowrap", c.className)} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">{emptyText}</td></tr>
            ) : filtered.map((r) => (
              <tr
                key={rowKey(r)}
                className={cn("border-t hover:bg-accent/40 transition", onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-2 py-1.5 align-middle", c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}