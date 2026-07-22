import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** SM(defect) 모듈용 Data Date 목록/최신값 조회.
 *  RPC `defect_data_dates()` (STABLE, SECURITY DEFINER) 사용 —
 *  is_active 행 기준 DISTINCT data_date 를 정확히 반환한다.
 *  (예전 클라이언트 distinct 방식은 최상위 날짜 하나가 5,000행 한계를
 *   전부 차지하면 다른 날짜가 누락되는 버그가 있어 폐기.)
 */
export function useDefectLatestDataDate() {
  const q = useQuery({
    queryKey: ["defect-latest-data-date"],
    queryFn: async (): Promise<{ options: string[]; latest: string | null }> => {
      const { data, error } = await (supabase as any).rpc("defect_data_dates");
      if (error) throw new Error(error.message);
      const options = ((data ?? []) as Array<{ d: string | null }>)
        .map((r) => (r?.d ? String(r.d).slice(0, 10) : ""))
        .filter(Boolean)
        .sort((a, b) => (a < b ? 1 : -1));
      return { options, latest: options[0] ?? null };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return {
    options: q.data?.options ?? [],
    latest: q.data?.latest ?? null,
    isLoading: q.isPending,
  };
}