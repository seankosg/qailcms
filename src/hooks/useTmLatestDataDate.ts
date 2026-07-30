import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** TM 최신 data_date(관측 컷오프) — 읽기 전용 칩 표시용. 판정에는 개입하지 않는다. */
export function useTmLatestDataDate() {
  return useQuery<string>({
    queryKey: ["tm-latest-data-date"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_management_raw")
        .select("data_date")
        .not("data_date", "is", null)
        .order("data_date", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return data?.[0]?.data_date ? String(data[0].data_date).slice(0, 10) : "";
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
