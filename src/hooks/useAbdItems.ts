import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AbdStatusGroup = "approved" | "in_progress" | "not_started" | "all";
export type AbdTeam = "mech" | "elec" | "arch";

export type AbdServerFilterOp = "in" | "in_or_empty" | "text" | "empty" | "date_range" | "num_range" | "bool";

export interface AbdServerFilter {
  column: string;
  op: AbdServerFilterOp;
  value: any;
}

export interface AbdServerSort {
  column: string;
  desc: boolean;
}

export interface AbdItem {
  id: string;
  team: AbdTeam;
  plot: string | null;
  sl_no: number | null;
  dis: string | null;
  service: string | null;
  doc_ax: string | null; doc_axx: string | null; doc_nn1: string | null; doc_n: string | null; doc_nn2: string | null;
  document_title: string | null;
  abd_number: string;
  abd_ocs_no: string | null;
  pic: string | null;
  latest_rev: string | null;
  latest_status: string | null;
  approval_date: string | null;
  r1_drafting_plan: string | null; r1_drafting_actual: string | null;
  r1_submission_plan: string | null; r1_submission_actual: string | null;
  r1_dar_plan: string | null; r1_dar_actual: string | null;
  r2_drafting_plan: string | null; r2_drafting_actual: string | null;
  r2_submission_plan: string | null; r2_submission_actual: string | null;
  r2_dar_plan: string | null; r2_dar_actual: string | null;
  r3_drafting_plan: string | null; r3_drafting_actual: string | null;
  r3_submission_plan: string | null; r3_submission_actual: string | null;
  r3_dar_plan: string | null; r3_dar_actual: string | null;
  is_active: boolean;
  field_mismatch: boolean;
  mismatch_fields: Record<string, any>;
  status_group: "approved" | "in_progress" | "not_started";
  data_date: string | null;
  updated_at: string | null;
  [key: string]: any;
}

export interface AbdItemsQueryParams {
  team: AbdTeam;
  statusGroup: AbdStatusGroup;
  includeInactive: boolean;
  q?: string;
  filters?: AbdServerFilter[];
  sort?: AbdServerSort[];
  page: number;
  pageSize: number;
}

export function useAbdItemsQuery(p: AbdItemsQueryParams) {
  return useQuery({
    queryKey: ["abd", "items", p],
    queryFn: async () => {
      const offset = Math.max(0, (p.page - 1) * p.pageSize);
      const { data, error } = await (supabase as any).rpc("abd_items_search", {
        _team: p.team,
        _status_group: p.statusGroup === "all" ? null : p.statusGroup,
        _include_inactive: p.includeInactive,
        _q: p.q && p.q.trim() ? p.q.trim() : null,
        _filters: p.filters ?? [],
        _sort: p.sort ?? [],
        _offset: offset,
        _limit: p.pageSize,
      });
      if (error) throw new Error(error.message);
      const arr = (data ?? []) as { rows: any; total_count: number | string }[];
      const rows: AbdItem[] = arr.map((r) => r.rows as AbdItem);
      const total = Number(arr[0]?.total_count ?? 0);
      return { rows, total };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}

export interface AbdFacetItem { value: string; cnt: number }

export function useAbdFacet(column: string | null, opts: { team: AbdTeam; statusGroup: AbdStatusGroup; includeInactive: boolean; enabled?: boolean }) {
  return useQuery<AbdFacetItem[]>({
    queryKey: ["abd", "facet", column, opts],
    queryFn: async () => {
      if (!column) return [];
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: column,
        _team: opts.team,
        _status_group: opts.statusGroup === "all" ? null : opts.statusGroup,
        _include_inactive: opts.includeInactive,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ value: String(r.value), cnt: Number(r.cnt) }));
    },
    enabled: !!column && opts.enabled !== false,
    staleTime: 60_000,
  });
}

export interface AbdCounts {
  approved_count: number;
  in_progress_count: number;
  not_started_count: number;
  total_count: number;
  latest_data_date: string | null;
}

export function useAbdCounts(opts: { team: AbdTeam; includeInactive: boolean }) {
  return useQuery<AbdCounts>({
    queryKey: ["abd", "counts", opts],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_counts", {
        _team: opts.team,
        _include_inactive: opts.includeInactive,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? [])[0] ?? {};
      return {
        approved_count: Number(r.approved_count ?? 0),
        in_progress_count: Number(r.in_progress_count ?? 0),
        not_started_count: Number(r.not_started_count ?? 0),
        total_count: Number(r.total_count ?? 0),
        latest_data_date: r.latest_data_date ?? null,
      };
    },
    staleTime: 30_000,
  });
}

export function useInvalidateAbd() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["abd"] }); };
}