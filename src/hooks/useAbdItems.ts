import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertNoTruncation } from "@/lib/data/assertNoSilentTruncation";
import { todayInDoha } from "@/lib/time/doha";

/** A-2: as_of 는 항상 클라이언트가 명시한다. 서버 폴백은 최후 방어선으로만 남긴다. */
function resolveAsOf(v?: string | null): string {
  return (v ?? "").trim() || todayInDoha();
}

export type AbdStatusGroup =
  | "approved"
  | "in_progress"
  | "not_started"
  | "unapproved"
  | "under_review"
  | "drafting"
  | "rs_delay"
  | "sb_delay"
  | "df_delay"
  | "ds_delay"
  | "no_plan"
  | "delayed"
  | "resubmit"
  | "cancelled"
  // Dashboard Status Mix 드릴다운 (정본 술어 = abd_dashboard_judgment_mix 와 동일)
  | "mix_approved"
  | "mix_ur"
  | "mix_ds"
  // Dashboard 자동 판정 분포 드릴다운
  | "jdg_done"
  | "jdg_normal"
  | "jdg_caution"
  | "jdg_delayed"
  | "jdg_critical"
  // stage_group 축 (Progress KPI 스트립): 재고 sg_*, 지연 sgd_*
  | "sg_ns"
  | "sg_ds"
  | "sg_df"
  | "sg_sb"
  | "sg_rs"
  | "sg_resubmit"
  | "sg_approved"
  | "sgd_ns"
  | "sgd_ds"
  | "sgd_df"
  | "sgd_sb"
  | "sgd_rs"
  | "all";
export type AbdTeam = "MECH" | "ELEC" | "ARCH" | "DESN" | "PRJC";

export type AbdServerFilterOp =
  | "in"
  | "in_or_empty"
  | "text"
  | "empty"
  | "date_range"
  | "date_range_or"
  | "num_range"
  | "bool"
  // Progress Matrix 셀 드릴다운 전용(술어 정본 = public.abd_progress_events)
  | "stage_plan_range"
  | "stage_actual_range";

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
  completed_stage: string | null;
  completed_stage_group: string | null;
  /** 의미 = 회신 대기(RS) 경과일. 내부 키 개명은 백로그(딥링크·RPC 하위호환). */
  ur_aging_days: number | null;
  data_date: string | null;
  updated_at: string | null;
  [key: string]: any;
}

export interface AbdItemsQueryParams {
  team: AbdTeam;
  statusGroup: AbdStatusGroup;
  plot?: "C" | "D" | null;
  q?: string;
  filters?: AbdServerFilter[];
  sort?: AbdServerSort[];
  page: number;
  pageSize: number;
  /** 판정 기준일(As of, YYYY-MM-DD). 빈 값 = 오늘(Doha). */
  asOf?: string | null;
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
          _q: p.q && p.q.trim() ? p.q.trim() : null,
          _filters: p.filters ?? [],
          _sort: p.sort ?? [],
          _offset: offset,
          _limit: limit,
          _plot: p.plot ?? null,
          _as_of: resolveAsOf(p.asOf),
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

      // ALL 등 대용량: 1) 첫 청크로 total 확보, 2) 나머지 청크를 병렬 페치 (R3).
      const firstBatch = await callRpc(baseOffset, CHUNK);
      const total = Number(firstBatch[0]?.total_count ?? 0);
      const target = Math.min(Math.max(0, total - baseOffset), p.pageSize);
      const collected: AbdItem[] = firstBatch.map((r) => r.rows as AbdItem);
      if (target > collected.length && firstBatch.length === CHUNK) {
        const remaining = target - collected.length;
        const extraChunks = Math.ceil(remaining / CHUNK);
        const offsets: number[] = [];
        for (let i = 1; i <= extraChunks; i++) {
          offsets.push(baseOffset + i * CHUNK);
        }
        const batches = await Promise.all(offsets.map((off) => callRpc(off, CHUNK)));
        for (const batch of batches) {
          for (const r of batch) collected.push(r.rows as AbdItem);
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
    plot?: "C" | "D" | null;
    enabled?: boolean;
    q?: string;
    filters?: AbdServerFilter[];
    asOf?: string | null;
  },
) {
  // 크로스 필터링: 자기 자신 컬럼 필터는 제외해 정확한 queryKey/카운트 산출.
  const qNorm = (opts.q ?? "").trim();
  const asOfNorm = resolveAsOf(opts.asOf);
  const otherFilters = (opts.filters ?? []).filter((f) => f.column !== column);
  return useQuery<AbdFacetItem[]>({
    queryKey: [
      "abd",
      "facet",
      column,
      { team: opts.team, statusGroup: opts.statusGroup, plot: opts.plot ?? null, q: qNorm, filters: otherFilters, asOf: asOfNorm },
    ],
    queryFn: async () => {
      if (!column) return [];
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: column,
        _team: opts.team,
        _status_group: opts.statusGroup === "all" ? null : opts.statusGroup,
        _plot: opts.plot ?? null,
        _q: qNorm.length > 0 ? qNorm : null,
        _filters: otherFilters,
        _as_of: asOfNorm,
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
  total_count: number;
  approved_count: number;
  ur_count: number;
  ds_count: number;
  resubmit_count: number;
  cancelled_count: number;
  latest_data_date: string | null;
}

export function useAbdCounts(opts: { team: AbdTeam; plot?: "C" | "D" | null; asOf?: string | null }) {
  return useQuery<AbdCounts>({
    queryKey: ["abd", "counts", opts],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_counts", {
        _team: opts.team,
        _plot: opts.plot ?? null,
        _as_of: resolveAsOf(opts.asOf),
      });
      if (error) throw new Error(error.message);
      const r = (data ?? [])[0] ?? {};
      return {
        total_count: Number(r.total_count ?? 0),
        approved_count: Number(r.approved_count ?? 0),
        ur_count: Number(r.ur_count ?? 0),
        ds_count: Number(r.ds_count ?? 0),
        resubmit_count: Number(r.resubmit_count ?? 0),
        cancelled_count: Number(r.cancelled_count ?? 0),
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