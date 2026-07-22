import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** SM(defect) 모듈용 Data Date 목록/최신값 조회.
 *  defect_items_raw.data_date 컬럼에서 활성행 기준 distinct 목록을 반환한다.
 *  RPC 없이 클라 distinct 처리 — 데이터량 과다 시 후속 RPC 전환.
 */
export function useDefectLatestDataDate() {
  const q = useQuery({
    queryKey: ["defect-latest-data-date"],
    queryFn: async (): Promise<{ options: string[]; latest: string | null }> => {
      const { data, error } = await (supabase as any)
        .from("defect_items_raw")
        .select("data_date")
        .eq("is_active", true)
        .not("data_date", "is", null)
        .order("data_date", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      const set = new Set<string>();
      for (const r of (data ?? []) as { data_date: string | null }[]) {
        if (r.data_date) set.add(String(r.data_date).slice(0, 10));
      }
      const options = Array.from(set).sort((a, b) => (a < b ? 1 : -1));
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