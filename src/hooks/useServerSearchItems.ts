import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertNoTruncation, type TruncationDiagnostics } from "@/lib/data/assertNoSilentTruncation";

/**
 * 서버 검색 공용 훅 골격.
 *
 * 규약 (AGENTS.md RPC 반환 정책 준수):
 *  - search RPC: RETURNS jsonb { rows, total_count, main_count? }
 *  - facets RPC: RETURNS TABLE(axis, value, cnt) — 축 목록 일괄 입력
 *  - ids   RPC : RETURNS jsonb (text[] | uuid[])
 *
 * 필터 매핑: 도메인 어댑터가 `serializeFilters(filters)` 로 RPC `_filters` (jsonb) 로 변환.
 * NULL 필터는 EMPTY_TOKEN 을 값 배열에 포함해 표현하며, 서버가 `col IS NULL OR col = ANY(...)` 로 해석.
 */

/** 공용 상수 — 모듈별 재정의 금지. 서버 SQL 도 이 리터럴을 인식해야 함. */
export const EMPTY_TOKEN = "__EMPTY__" as const;

export type PageSizeMode = number | "ALL";

export interface ServerFilter {
  column: string;
  op: "in" | "in_or_empty" | "empty" | "range" | "text";
  value?: unknown;
}

export interface UseServerSearchItemsParams<TFilters, TRow> {
  /** 도메인 식별자 (queryKey 네임스페이스) */
  scope: string;
  /** 검색 RPC 이름 — RETURNS jsonb */
  searchRpc: string;
  /** facets RPC 이름 — RETURNS TABLE(axis,value,cnt), _columns text[] 입력 */
  facetsRpc: string;
  /** ids RPC 이름 — RETURNS jsonb 배열 (선택) */
  idsRpc?: string;
  /** 검색어 */
  q: string;
  /** 도메인 필터 (원본) */
  filters: TFilters;
  /** 정렬 (원본) */
  sort?: unknown;
  /** 페이지 (0-base) */
  page: number;
  /** 페이지 크기 — 숫자 or "ALL" */
  pageSize: PageSizeMode;
  /** facets 축 목록 (facets queryKey 구성 요소) */
  facetAxes: string[];
  /** 도메인 필터 → RPC _filters(jsonb) 어댑터 */
  serializeFilters: (filters: TFilters) => ServerFilter[];
  /** 도메인 정렬 → RPC _sort(jsonb) 어댑터 (선택) */
  serializeSort?: (sort: unknown) => unknown;
  /** 행 매퍼 (jsonb rows[] → TRow[]) */
  mapRow?: (raw: unknown) => TRow;
  /** search 결과에 관계없이 facets 를 병렬 실행할지 (기본 true) */
  facetsParallel?: boolean;
  /** 인활성 포함 여부 (RPC 전달) */
  includeInactive?: boolean;
  /** 훅 활성화 */
  enabled?: boolean;
}

export interface FacetsMap {
  [axis: string]: Array<{ value: string; cnt: number }>;
}

export interface UseServerSearchItemsResult<TRow> {
  rows: TRow[];
  totalCount: number;
  mainCount: number | null;
  facets: FacetsMap;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  facetsError: unknown;
  refetch: () => void;
  /** 필터된 전체 ID 배열을 lazy 로 가져옴 (idsRpc 필요) */
  fetchAllIds: () => Promise<string[]>;
  diagnostics: TruncationDiagnostics;
}

/** 페이지 크기 상수 매핑 */
function resolveLimit(pageSize: PageSizeMode): number {
  return pageSize === "ALL" ? 0 : pageSize;
}

export function useServerSearchItems<TFilters, TRow = Record<string, unknown>>(
  params: UseServerSearchItemsParams<TFilters, TRow>,
): UseServerSearchItemsResult<TRow> {
  const {
    scope,
    searchRpc,
    facetsRpc,
    idsRpc,
    q,
    filters,
    sort,
    page,
    pageSize,
    facetAxes,
    serializeFilters,
    serializeSort,
    mapRow,
    includeInactive = false,
    enabled = true,
  } = params;

  const serializedFilters = serializeFilters(filters);
  const serializedSort = serializeSort ? serializeSort(sort) : sort ?? [];
  const limit = resolveLimit(pageSize);
  const offset = pageSize === "ALL" ? 0 : page * (pageSize as number);

  // 1) search
  const searchKey = [
    `${scope}:search`,
    q,
    serializedFilters,
    serializedSort,
    page,
    pageSize,
    includeInactive,
  ] as const;

  const search = useQuery({
    queryKey: searchKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(searchRpc as never, {
        _q: q || null,
        _filters: serializedFilters,
        _sort: serializedSort,
        _offset: offset,
        _limit: limit,
        _include_inactive: includeInactive,
      } as never);
      if (error) throw error;
      const payload = (data ?? {}) as {
        rows?: unknown[];
        total_count?: number;
        main_count?: number;
      };
      return {
        rows: (payload.rows ?? []) as unknown[],
        totalCount: payload.total_count ?? 0,
        mainCount: payload.main_count ?? null,
      };
    },
  });

  // 2) facets — search 와 완전 병렬, page/pageSize/sort 제외
  const facetsKey = [
    `${scope}:facets`,
    q,
    serializedFilters,
    facetAxes,
    includeInactive,
  ] as const;

  const facets = useQuery({
    queryKey: facetsKey,
    enabled: enabled && facetAxes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(facetsRpc as never, {
        _columns: facetAxes,
        _q: q || null,
        _filters: serializedFilters,
        _include_inactive: includeInactive,
      } as never);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ axis: string; value: string; cnt: number }>;
      const grouped: FacetsMap = {};
      for (const r of rows) {
        (grouped[r.axis] ??= []).push({ value: r.value, cnt: Number(r.cnt) });
      }
      return grouped;
    },
  });

  // 진단
  const rows = (search.data?.rows ?? []) as unknown[];
  const total = search.data?.totalCount ?? 0;
  const mainCount = search.data?.mainCount ?? null;

  const diagnostics: TruncationDiagnostics =
    pageSize === "ALL"
      ? assertNoTruncation(`${scope}.search`, rows, total, "ALL")
      : assertNoTruncation(`${scope}.search`, rows, total, "page", {
          pageSize: pageSize as number,
          mainCount: mainCount ?? undefined,
        });

  const mappedRows = mapRow ? rows.map((r) => mapRow(r)) : (rows as TRow[]);

  const fetchAllIds = async (): Promise<string[]> => {
    if (!idsRpc) return [];
    const { data, error } = await supabase.rpc(idsRpc as never, {
      _q: q || null,
      _filters: serializedFilters,
      _include_inactive: includeInactive,
    } as never);
    if (error) throw error;
    const arr = Array.isArray(data) ? (data as unknown[]) : [];
    return arr.map(String);
  };

  return {
    rows: mappedRows,
    totalCount: total,
    mainCount,
    facets: facets.data ?? {},
    isLoading: search.isLoading || facets.isLoading,
    isFetching: search.isFetching || facets.isFetching,
    isError: search.isError,
    error: search.error,
    facetsError: facets.error,
    refetch: () => {
      search.refetch();
      facets.refetch();
    },
    fetchAllIds,
    diagnostics,
  };
}