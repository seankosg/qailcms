/**
 * TM Raw Data — 무한 스크롤 데이터 소스 (C1-b).
 *
 * - Main 100 페이지 단위로 tm_items_search 를 호출하고, 응답 rows(Main + 그 Sub)를
 *   누적(concat)해 하나의 배열로 노출한다.
 * - loadMore() 호출 시 다음 페이지를 이어붙인다. hasMore 는 mainCount 기반으로 판단.
 * - 검색어/서버 필터/서버 정렬이 바뀌면 자동으로 페이지 스택을 리셋한다.
 * - 클라이언트 전용 필터/정렬(stage_progress, today_*, progress_variance)이 활성이면
 *   자동으로 pageSize="ALL" 모드로 전환(1회 전량 로드) → 클라이언트 필터/정렬이
 *   모든 데이터를 볼 수 있게 보장(부분 로드로 인한 결과 누락 방지).
 *
 * UI 계약: 페이지 컴포넌트는 반환된 rows 를 그대로 React Table 에 흘려주고,
 * 스크롤이 하단에 근접하면 loadMore() 호출만 하면 된다. UI 요소·배치는 불변.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ServerFilter } from "@/hooks/useServerSearchItems";
import type { ServerSortEntry } from "@/lib/task-management/server-bridge";
import type { TaskThresholds } from "@/lib/task-management/derived";

export interface UseTmInfiniteItemsParams {
  q: string;
  serverFilters: ServerFilter[];
  serverSort: ServerSortEntry[];
  /** true 면 페이지 무시하고 pageSize="ALL" 로 1회 전량 로드 */
  forceAll: boolean;
  includeInactive?: boolean;
  pageSizeMains?: number;
  enabled?: boolean;
  /** Dashboard 정본 판정용 as_of 날짜(YYYY-MM-DD). 지정 시 서버가 derived_auto_judgment 를 계산해 반환. */
  asOf?: string | null;
  /** Dashboard 정본 판정용 임계값. asOf 와 함께 지정되어야 서버 판정이 활성화됨. */
  thresholds?: TaskThresholds | null;
  /** Dashboard KPI 딥링크 진입 시 서버에서 tm_kpi_bucket_matches 로 필터. null 이면 미적용. */
  kpiMode?: string | null;
}

export interface UseTmInfiniteItemsResult<TRow = Record<string, unknown>> {
  rows: TRow[];
  totalCount: number;
  mainCount: number;
  loadedMains: number;
  hasMore: boolean;
  isInitialLoading: boolean;
  isFetchingMore: boolean;
  isError: boolean;
  error: unknown;
  loadMore: () => void;
  reset: () => void;
  /** 캐시 강제 무효화 후 첫 페이지부터 재조회 */
  refetch: () => Promise<void>;
  /** 필터된 전체 ID (tm_items_search_ids). ALL 모드에서도 안전 호출. */
  fetchAllIds: () => Promise<string[]>;
  /** 특정 행(id) 부분 패치 — 캐시 + 누적 배열에 즉시 반영. 네트워크 미발생. */
  patchRow: (id: string, patch: Record<string, unknown>) => void;
  /**
   * 서버에서 해당 행 1건을 현재와 동일한 _as_of/_thresholds 로 재조회 후 캐시 패치.
   * 반환값: 서버가 반환한 행(auto_judgment 포함). 매칭 없으면 null.
   * (편집 결과 파생값·판정 뱃지 즉시 반영용)
   */
  refetchRow: (id: string) => Promise<Record<string, unknown> | null>;
}

const DEFAULT_PAGE_MAINS = 100;

function keySignature(
  q: string,
  filters: ServerFilter[],
  sort: ServerSortEntry[],
  includeInactive: boolean,
  forceAll: boolean,
  pageSize: number,
  asOf: string | null,
  thresholds: TaskThresholds | null,
  kpiMode: string | null,
): string {
  return JSON.stringify({ q, filters, sort, includeInactive, forceAll, pageSize, asOf, thresholds, kpiMode });
}

export function useTmInfiniteItems<TRow = Record<string, unknown>>(
  params: UseTmInfiniteItemsParams,
): UseTmInfiniteItemsResult<TRow> {
  const {
    q,
    serverFilters,
    serverSort,
    forceAll,
    includeInactive = false,
    pageSizeMains = DEFAULT_PAGE_MAINS,
    enabled = true,
    asOf = null,
    thresholds = null,
    kpiMode = null,
  } = params;

  const qc = useQueryClient();
  const sig = useMemo(
    () => keySignature(q, serverFilters, serverSort, includeInactive, forceAll, pageSizeMains, asOf, thresholds, kpiMode),
    [q, serverFilters, serverSort, includeInactive, forceAll, pageSizeMains, asOf, thresholds, kpiMode],
  );

  // 검색/필터/정렬/모드 변경 시 페이지 리셋
  const [page, setPage] = useState(0);
  const lastSigRef = useRef(sig);
  useEffect(() => {
    if (lastSigRef.current !== sig) {
      lastSigRef.current = sig;
      setPage(0);
    }
  }, [sig]);

  // 각 페이지를 개별 useQuery 로 저장 → HMR/네비 이후에도 캐시 재사용
  const pageKeys = useMemo(
    () => Array.from({ length: page + 1 }, (_, i) => ["tm-inf", sig, i] as const),
    [sig, page],
  );

  // 현재 페이지 fetch — 이전 페이지는 캐시에서 읽기만
  const current = useQuery({
    queryKey: pageKeys[page],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const limit = forceAll ? 5000 : pageSizeMains;
      const offset = forceAll ? 0 : page * pageSizeMains;
      const { data, error } = await (supabase as any).rpc("tm_items_search", {
        _q: q || null,
        _filters: serverFilters,
        _sort: serverSort,
        _offset: offset,
        _limit: limit,
        _include_inactive: includeInactive,
        _kpi_mode: kpiMode ?? null,
        _as_of: asOf ?? null,
        _thresholds: thresholds
          ? {
              worsen_gap: thresholds.worsen_gap,
              caution_gap_buffer: thresholds.caution_gap_buffer,
            }
          : null,
      });
      if (error) throw error;
      if (data == null || Array.isArray(data) || typeof data !== "object") {
        throw new Error("tm_items_search RPC contract mismatch: expected jsonb object");
      }
      const payload = data as {
        rows?: unknown[];
        total_count?: number;
        main_count?: number;
      };
      // 서버가 계산한 derived_auto_judgment 를 auto_judgment 로 승격 → 셀 뱃지/필터 정합성 보장.
      const rawRows = (payload.rows ?? []) as any[];
      const mapped: TRow[] = rawRows.map((r) => {
        if (r && Object.prototype.hasOwnProperty.call(r, "derived_auto_judgment")) {
          const { derived_auto_judgment, ...rest } = r;
          return { ...rest, auto_judgment: derived_auto_judgment ?? rest.auto_judgment } as TRow;
        }
        return r as TRow;
      });
      return {
        rows: mapped,
        totalCount: Number(payload.total_count ?? 0),
        mainCount: Number(payload.main_count ?? 0),
      };
    },
  });

  // R1: 누적 배열 참조 안정화
  // - 각 페이지 slice(pageRowsRef)는 해당 페이지 fetch 완료 시 1회만 갱신되고 이후 동일 참조 유지
  // - accumulated.rows 는 [sig, loadedPageCount] 에만 의존 → 신규 페이지가 실제로 착지한 순간에만
  //   새 배열 생성. 이전 페이지의 row 객체 identity 는 그대로 유지되어 하위 memo/virtualizer 가
  //   기존 행을 재계산하지 않고 신규 구간만 measure 하도록 함.
  const pageRowsRef = useRef<Map<string, TRow[]>>(new Map());
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  // R4: 부분 패치용 리비전 (accumulated 재계산 트리거).
  const [patchRev, setPatchRev] = useState(0);
  // sig 변경 시 slice 캐시/카운트 리셋
  useEffect(() => {
    pageRowsRef.current = new Map();
    setLoadedPageCount(0);
  }, [sig]);
  // 현재 페이지 fetch 완료 시 slice 등록 (동일 페이지 재-fetch 시 참조가 새로 잡히지 않도록 pageKey 단위)
  useEffect(() => {
    if (!current.data) return;
    const pageKey = String(page);
    const prev = pageRowsRef.current.get(pageKey);
    // rows 배열 참조가 바뀐 경우에만 교체 (react-query 는 동일 응답 시 동일 참조 유지)
    if (prev !== current.data.rows) {
      pageRowsRef.current.set(pageKey, current.data.rows);
    }
    const nextCount = Math.max(loadedPageCount, page + 1);
    if (nextCount !== loadedPageCount) setLoadedPageCount(nextCount);
  }, [current.data, page, loadedPageCount]);

  const accumulated = useMemo(() => {
    const out: TRow[] = [];
    let total = 0;
    let mains = 0;
    for (let i = 0; i < loadedPageCount; i++) {
      const slice = pageRowsRef.current.get(String(i));
      if (slice && slice.length) out.push(...slice);
      const cached = qc.getQueryData<{ rows: TRow[]; totalCount: number; mainCount: number }>(
        pageKeys[i] as unknown as readonly unknown[],
      );
      if (cached) {
        total = cached.totalCount;
        mains = cached.mainCount;
      }
    }
    return { rows: out, totalCount: total, mainCount: mains };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loadedPageCount, patchRev]);

  const loadedMains = forceAll
    ? accumulated.mainCount
    : Math.min((page + 1) * pageSizeMains, accumulated.mainCount || (page + 1) * pageSizeMains);
  const hasMore = !forceAll && !current.isFetching && loadedMains < accumulated.mainCount;

  const loadMore = useCallback(() => {
    if (forceAll) return;
    if (current.isFetching) return;
    if (loadedMains >= accumulated.mainCount) return;
    setPage((p) => p + 1);
  }, [forceAll, current.isFetching, loadedMains, accumulated.mainCount]);

  const reset = useCallback(() => {
    pageRowsRef.current = new Map();
    setLoadedPageCount(0);
    setPage(0);
  }, []);

  const refetch = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["tm-inf", sig] });
    pageRowsRef.current = new Map();
    setLoadedPageCount(0);
    setPage(0);
  }, [qc, sig]);

  const fetchAllIds = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("tm_items_search_ids", {
      _q: q || null,
      _filters: serverFilters,
      _include_inactive: includeInactive,
      _limit: 100000,
      _kpi_mode: kpiMode ?? null,
      _as_of: asOf ?? null,
      _thresholds: thresholds
        ? {
            worsen_gap: thresholds.worsen_gap,
            caution_gap_buffer: thresholds.caution_gap_buffer,
          }
        : null,
    });
    if (error) throw error;
    const arr = Array.isArray(data) ? (data as unknown[]) : [];
    return arr.map(String);
  }, [q, serverFilters, includeInactive, asOf, thresholds, kpiMode]);

  const patchRow = useCallback((id: string, patch: Record<string, unknown>) => {
    let touched = false;
    for (let i = 0; i < loadedPageCount; i++) {
      const pageKey = String(i);
      const slice = pageRowsRef.current.get(pageKey);
      if (!slice || slice.length === 0) continue;
      const idx = slice.findIndex((r: any) => String((r as any)?.id) === id);
      if (idx === -1) continue;
      const next = slice.slice();
      next[idx] = { ...(slice[idx] as any), ...patch } as TRow;
      pageRowsRef.current.set(pageKey, next);
      // react-query 캐시도 동기 갱신
      const key = pageKeys[i] as unknown as readonly unknown[];
      const cached = qc.getQueryData<{ rows: TRow[]; totalCount: number; mainCount: number }>(key);
      if (cached) {
        qc.setQueryData(key, { ...cached, rows: next });
      }
      touched = true;
    }
    if (touched) setPatchRev((v) => v + 1);
  }, [loadedPageCount, pageKeys, qc]);

  return {
    rows: accumulated.rows,
    totalCount: accumulated.totalCount,
    mainCount: accumulated.mainCount,
    loadedMains,
    hasMore,
    isInitialLoading: current.isLoading && page === 0,
    isFetchingMore: current.isFetching && page > 0,
    isError: current.isError,
    error: current.error,
    loadMore,
    reset,
    refetch,
    fetchAllIds,
    patchRow,
  };
}