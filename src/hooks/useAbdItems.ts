import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertNoTruncation } from "@/lib/data/assertNoSilentTruncation";

export type AbdStatusGroup =
  | "approved"
  | "in_progress"
  | "not_started"
  | "under_review"
  | "drafting"
  | "rs_delay"
  | "sb_delay"
  | "ds_delay"
  | "no_plan"
  | "delayed"
  | "all";
export type AbdTeam = "MECH" | "ELEC" | "ARCH" | "DESN" | "PRJC";

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
  r1_draft_finish_plan: string | null; r1_draft_finish_actual: string | null;
  r1_submission_plan: string | null; r1_submission_actual: string | null;
  r1_dar_plan: string | null; r1_dar_actual: string | null;
  r2_draft_finish_plan: string | null; r2_draft_finish_actual: string | null;
  r2_submission_plan: string | null; r2_submission_actual: string | null;
  r2_dar_plan: string | null; r2_dar_actual: string | null;
  r3_draft_finish_plan: string | null; r3_draft_finish_actual: string | null;
  r3_submission_plan: string | null; r3_submission_actual: string | null;
  r3_dar_plan: string | null; r3_dar_actual: string | null;
  is_active: boolean;
  status_group: "approved" | "in_progress" | "not_started";
  current_stage: string | null;
  ur_aging_days: number | null;
  data_date: string | null;
  updated_at: string | null;
  [key: string]: any;
}

export interface AbdItemsQueryParams {
  team: AbdTeam;
  statusGroup: AbdStatusGroup;
  includeInactive: boolean;
  plot?: "C" | "D" | null;
  q?: string;
  filters?: AbdServerFilter[];
  sort?: AbdServerSort[];
  page: number;
  pageSize: number;
  excludedMode?: "hide" | "only" | "all";
}

export function useAbdItemsQuery(p: AbdItemsQueryParams) {
  return useQuery({
    queryKey: ["abd", "items", p],
    queryFn: async () => {
      // PostgREST 응답 상한(1,000행)을 우회하기 위해 pageSize > CHUNK 일 때 청크 루프 페칭.
      const CHUNK = 1000;
      const baseOffset = Math.max(0, (p.page - 1) * p.pageSize);
      const callRpc = async (offset: number, limit: number) => {
        const { data, error } = await (supabase as any).rpc("abd_items_search", {
          _team: p.team,
          _status_group: p.statusGroup === "all" ? null : p.statusGroup,
          _include_inactive: p.includeInactive,
          _q: p.q && p.q.trim() ? p.q.trim() : null,
          _filters: p.filters ?? [],
          _sort: p.sort ?? [],
          _offset: offset,
          _limit: limit,
          _plot: p.plot ?? null,
          _excluded_mode: p.excludedMode ?? "hide",
        });
        if (error) throw new Error(error.message);
        const arr = (data ?? []) as { rows: any; total_count: number | string }[];
        // Contract: abd_items_search returns one row per record (rows = to_jsonb(record)).
        // Matches SM/Defect (defect_items_search). If a jsonb_agg-style shape sneaks back in,
        // fail loudly here instead of silently rendering empty cells.
        if (arr.length > 0) {
          const first = arr[0] as any;
          const rowsVal = first?.rows;
          if (Array.isArray(rowsVal) || rowsVal === null || typeof rowsVal !== "object") {
            throw new Error(
              "abd_items_search RPC contract mismatch: expected row-per-record { rows: object, total_count }, got rows=" +
                (Array.isArray(rowsVal) ? "array" : rowsVal === null ? "null" : typeof rowsVal),
            );
          }
        }
        return arr;
      };

      // 단일 호출로 충분한 경우 (기본 페이지 50~500).
      if (p.pageSize <= CHUNK) {
        const arr = await callRpc(baseOffset, p.pageSize);
        const rows: AbdItem[] = arr.map((r) => r.rows as AbdItem);
        const total = Number(arr[0]?.total_count ?? 0);
        return { rows, total };
      }

      // ALL 등 대용량: CHUNK 단위 루프.
      // 표준안: offset 전진은 collected.length(= 실제 반환 batch.length 누적) 기반.
      //         종료 조건은 target 도달, batch.length === 0, 또는 batch.length < CHUNK.
      const firstBatch = await callRpc(baseOffset, CHUNK);
      const total = Number(firstBatch[0]?.total_count ?? 0);
      const target = Math.min(total - baseOffset, p.pageSize);
      const collected: AbdItem[] = firstBatch.map((r) => r.rows as AbdItem);
      const maxIterations = Math.ceil(p.pageSize / CHUNK) + 1;
      let iterations = 1;
      let lastBatchLen = firstBatch.length;
      while (collected.length < target) {
        if (lastBatchLen < CHUNK) break; // 마지막 페이지 도달
        if (++iterations > maxIterations) {
          throw new Error(`abd_items_search chunk loop exceeded ${maxIterations} iterations`);
        }
        const prev = collected.length;
        const batch = await callRpc(baseOffset + collected.length, CHUNK);
        lastBatchLen = batch.length;
        if (batch.length === 0) break;
        for (const r of batch) collected.push(r.rows as AbdItem);
        if (collected.length === prev) {
          throw new Error("abd_items_search chunk loop stalled (no progress)");
        }
      }
      const finalRows = collected.slice(0, target);
      // ALL(=pageSize>=total) 사용 시 잘림 감시. 부분 페이지에서는 target < total 이 정상.
      if (p.pageSize >= total) {
        assertNoTruncation("abd_items_search(ALL)", finalRows, total);
      }
      return { rows: finalRows, total };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}

export interface AbdFacetItem { value: string; cnt: number }

export function useAbdFacet(
  column: string | null,
  opts: {
    team: AbdTeam;
    statusGroup: AbdStatusGroup;
    includeInactive: boolean;
    plot?: "C" | "D" | null;
    enabled?: boolean;
    q?: string;
    filters?: AbdServerFilter[];
  },
) {
  // 크로스 필터링: 자기 자신 컬럼 필터는 제외해 정확한 queryKey/카운트 산출.
  const qNorm = (opts.q ?? "").trim();
  const otherFilters = (opts.filters ?? []).filter((f) => f.column !== column);
  return useQuery<AbdFacetItem[]>({
    queryKey: [
      "abd",
      "facet",
      column,
      { team: opts.team, statusGroup: opts.statusGroup, includeInactive: opts.includeInactive, plot: opts.plot ?? null, q: qNorm, filters: otherFilters },
    ],
    queryFn: async () => {
      if (!column) return [];
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: column,
        _team: opts.team,
        _status_group: opts.statusGroup === "all" ? null : opts.statusGroup,
        _include_inactive: opts.includeInactive,
        _plot: opts.plot ?? null,
        _q: qNorm.length > 0 ? qNorm : null,
        _filters: otherFilters,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({ value: String(r.value), cnt: Number(r.cnt) }));
    },
    enabled: !!column && opts.enabled !== false,
    // 크로스필터: 다른 필터가 바뀌면 곧 다시 열릴 때 최신 카운트를 보여야 하므로 짧게.
    staleTime: 15_000,
    refetchOnMount: "always",
  });
}

export interface AbdCounts {
  approved_count: number;
  in_progress_count: number;
  not_started_count: number;
  total_count: number;
  excluded_count: number;
  latest_data_date: string | null;
}

export function useAbdCounts(opts: { team: AbdTeam; includeInactive: boolean; plot?: "C" | "D" | null }) {
  return useQuery<AbdCounts>({
    queryKey: ["abd", "counts", opts],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_counts", {
        _team: opts.team,
        _include_inactive: opts.includeInactive,
        _plot: opts.plot ?? null,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? [])[0] ?? {};
      return {
        approved_count: Number(r.approved_count ?? 0),
        in_progress_count: Number(r.in_progress_count ?? 0),
        not_started_count: Number(r.not_started_count ?? 0),
        total_count: Number(r.total_count ?? 0),
        excluded_count: Number(r.excluded_count ?? 0),
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