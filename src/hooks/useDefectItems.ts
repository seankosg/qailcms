import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────
export type DefectStatusGroup = "unclosed" | "closed" | "all";

export type DefectServerFilterOp =
  | "in"
  | "text"
  | "empty"
  | "date_range"
  | "num_range"
  | "bool";

export interface DefectServerFilter {
  column: string;
  op: DefectServerFilterOp;
  value: any;
}

export interface DefectServerSort {
  column: string;
  desc: boolean;
}

// Superset row shape (JSONB from server). Optional fields to keep compat.
export interface DefectItem {
  id: string;
  source_issue_no: string;
  team: string | null;
  status_raw: string | null;
  status_group?: "unclosed" | "closed" | null;
  is_active: boolean;
  is_critical: boolean;
  data_date: string | null;
  actual_closure_date: string | null;
  actual_rectified_date: string | null;
  closure_status: string | null;
  due_by: string | null;
  planned_start_date: string | null;
  planned_rectified_date: string | null;
  planned_closure_date: string | null;
  actual_start_date: string | null;
  planned_progress_pct: number | null;
  actual_progress_pct: number | null;
  priority: string | null;
  hdec_verification: string | null;
  priority_locked?: boolean;
  hdec_verification_locked?: boolean;
  [key: string]: any;
}

export interface DefectItemsQueryParams {
  statusGroup: DefectStatusGroup;
  includeInactive: boolean;
  q?: string;
  filters?: DefectServerFilter[];
  sort?: DefectServerSort[];
  page: number;
  pageSize: number;
}

export interface DefectItemsQueryResult {
  rows: DefectItem[];
  total: number;
}

// ── defect_items_search ───────────────────────────────────────────────────
export function useDefectItemsQuery(p: DefectItemsQueryParams) {
  return useQuery<DefectItemsQueryResult>({
    queryKey: ["defect", "items", p],
    queryFn: async () => {
      const offset = Math.max(0, (p.page - 1) * p.pageSize);
      const { data, error } = await (supabase as any).rpc("defect_items_search", {
        _status_group: p.statusGroup,
        _include_inactive: p.includeInactive,
        _q: p.q && p.q.trim() ? p.q.trim() : null,
        _filters: p.filters ?? [],
        _sort: p.sort ?? [],
        _offset: offset,
        _limit: p.pageSize,
      });
      if (error) throw new Error(error.message);
      const arr = (data ?? []) as { rows: any; total_count: number | string }[];
      const rows: DefectItem[] = arr.map((r) => r.rows as DefectItem);
      const total = Number(arr[0]?.total_count ?? 0);
      return { rows, total };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}

// ── defect_items_facets ───────────────────────────────────────────────────
export interface DefectFacetItem {
  value: string;
  cnt: number;
}

// ── defect_items_search_ids ───────────────────────────────────────────────
// 현재 필터/검색 조건에 매칭되는 전체 행의 id만 반환 (대량 선택용)
export async function fetchDefectItemIds(params: {
  statusGroup: DefectStatusGroup;
  includeInactive: boolean;
  q?: string;
  filters?: DefectServerFilter[];
  limit?: number;
}): Promise<string[]> {
  const { data, error } = await (supabase as any).rpc("defect_items_search_ids", {
    _status_group: params.statusGroup,
    _include_inactive: params.includeInactive,
    _q: params.q && params.q.trim() ? params.q.trim() : null,
    _filters: params.filters ?? [],
    _limit: params.limit ?? 100_000,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((r) => String(r.id));
}

export function useDefectFacet(
  column: string | null,
  opts: {
    statusGroup: DefectStatusGroup;
    includeInactive: boolean;
    enabled?: boolean;
    q?: string;
    filters?: DefectServerFilter[];
  },
) {
  const otherFilters = (opts.filters ?? []).filter((f) => f.column !== column);
  const qNorm = opts.q && opts.q.trim() ? opts.q.trim() : null;
  return useQuery<DefectFacetItem[]>({
    queryKey: [
      "defect",
      "facet",
      column,
      {
        statusGroup: opts.statusGroup,
        includeInactive: opts.includeInactive,
        q: qNorm,
        filters: otherFilters,
      },
    ],
    queryFn: async () => {
      if (!column) return [];
      const { data, error } = await (supabase as any).rpc("defect_items_facets", {
        _column: column,
        _status_group: opts.statusGroup,
        _include_inactive: opts.includeInactive,
        _q: qNorm,
        _filters: otherFilters,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ value: String(r.value), cnt: Number(r.cnt) }));
    },
    enabled: !!column && opts.enabled !== false,
    staleTime: 60_000,
  });
}

// ── defect_items_counts ───────────────────────────────────────────────────
export interface DefectStatusCounts {
  unclosed_count: number;
  closed_count: number;
  total_count: number;
}

export function useDefectStatusCounts(opts: { includeInactive: boolean }) {
  return useQuery<DefectStatusCounts>({
    queryKey: ["defect", "counts", opts],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("defect_items_counts", {
        _include_inactive: opts.includeInactive,
      });
      if (error) throw new Error(error.message);
      const row = (data ?? [])[0] ?? { unclosed_count: 0, closed_count: 0, total_count: 0 };
      return {
        unclosed_count: Number(row.unclosed_count ?? 0),
        closed_count: Number(row.closed_count ?? 0),
        total_count: Number(row.total_count ?? 0),
      };
    },
    staleTime: 30_000,
  });
}

// ── defect_items_dashboard_summary ────────────────────────────────────────
export interface DefectDashboardSummary {
  latest_data_date: string | null;
  unclosed_count: number;
  closed_count: number;
  critical_pending: number;
  overdue_count: number;
  by_team: Record<string, number>;
}

export function useDefectDashboardSummary(opts: { includeInactive: boolean }) {
  return useQuery<DefectDashboardSummary>({
    queryKey: ["defect", "summary", opts],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("defect_items_dashboard_summary", {
        _include_inactive: opts.includeInactive,
      });
      if (error) throw new Error(error.message);
      const raw = (data ?? {}) as any;
      return {
        latest_data_date: raw.latest_data_date ?? null,
        unclosed_count: Number(raw.unclosed_count ?? 0),
        closed_count: Number(raw.closed_count ?? 0),
        critical_pending: Number(raw.critical_pending ?? 0),
        overdue_count: Number(raw.overdue_count ?? 0),
        by_team: (raw.by_team ?? {}) as Record<string, number>,
      };
    },
    staleTime: 60_000,
  });
}

// ── Invalidation helper ───────────────────────────────────────────────────
export function useInvalidateDefects() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["defect"] });
  };
}