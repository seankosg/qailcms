import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROW_TYPES } from "@/lib/task-management/columns";

/** TM Raw Data 에 실제 존재하는 Work Type(row_type) 값 + 코드 기본값 합집합. */
export function useTmWorkTypeOptions() {
  return useQuery({
    queryKey: ["tm-work-type-options"],
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("row_type")
        .not("row_type", "is", null)
        .limit(5000);
      if (error) throw new Error(error.message);
      const set = new Set<string>(ROW_TYPES as readonly string[]);
      for (const r of (data ?? []) as Array<{ row_type: string | null }>) {
        const v = (r.row_type ?? "").trim();
        if (v) set.add(v);
      }
      return [...set].sort((a, b) => a.localeCompare(b, "ko"));
    },
  });
}
