import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * TM 정본 as-of 행 소스 (단일 진입점).
 * 서버 `tm_rows_as_of(_as_of)` = 실적 마스킹 + 정본 판정(tm_kpi_judgment_g, Main 가중 계획 tm_row_tplan) 적용.
 * jsonb 래퍼(`tm_rows_as_of_json`)를 경유해 PostgREST 1,000행 상한을 회피한다.
 *
 * TM 화면(대시보드·Task Summary·Raw Data 파생 표시)은 이 훅 또는 서버 RPC(tm_*_as_of 경유)만 사용한다.
 * `task_management_raw` 직조회는 임포트·편집 등 쓰기 경로에서만 허용된다.
 */
export interface TmAsOfRow {
  id: string;
  auto_judgment: string | null;
  actual_progress: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  gap_pct: number | null;
  delay_days: number | null;
  alarm_reason: string | null;
  [key: string]: unknown;
}

/** 서버 정본 병합 필드 — 클라 재계산보다 항상 우선한다. */
export function withSrvFields<T extends Record<string, unknown>>(r: T): T {
  const actual = r.cum_actual_pct == null ? null : Number(r.cum_actual_pct);
  return {
    ...r,
    srv_judgment: (r.auto_judgment as string | null) ?? "이력 없음",
    srv_plan_pct: r.cum_plan_pct == null ? null : Number(r.cum_plan_pct),
    srv_actual_pct: actual,
  } as T;
}

async function fetchRows(asOf: string): Promise<TmAsOfRow[]> {
  const { data, error } = await (supabase as any).rpc("tm_rows_as_of_json", { p_as_of: asOf });
  if (error) throw new Error(error.message);
  if (data != null && !Array.isArray(data)) {
    throw new Error("tm_rows_as_of_json RPC contract mismatch: expected jsonb array");
  }
  return (((data ?? []) as unknown[]) as TmAsOfRow[]).map((r) => withSrvFields(r));
}

/** as-of 정본 행 전량(배열). 화면별 필터는 클라이언트에서 수행한다. */
export function useTmAsOfRows(asOf: string, enabled = true) {
  return useQuery({
    queryKey: ["tm-rows-as-of", asOf],
    queryFn: () => fetchRows(asOf),
    enabled: enabled && !!asOf,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: TmAsOfRow[] | undefined) => prev,
  });
}

/** id → 정본 행 맵. */
export function useTmRowsAsOf(asOf: string, enabled = true) {
  const q = useTmAsOfRows(asOf, enabled);
  const map = new Map<string, TmAsOfRow>();
  for (const r of q.data ?? []) map.set(r.id, r);
  return { map, rows: q.data ?? [], ready: !!q.data, isLoading: q.isLoading };
}
