import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SubconRule } from "@/lib/defect-management/auto-fill-rules";

const SUBCON_KEY = ["defect-subcon-rules"] as const;

export function useDefectSubconRules() {
  return useQuery({
    queryKey: SUBCON_KEY,
    queryFn: async (): Promise<SubconRule[]> => {
      const { data, error } = await (supabase as any)
        .from("defect_subcon_rules")
        .select("id, plot, room_group, trade_keywords, subcontractor_name, sort_order, is_active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubconRule[];
    },
  });
}

export function useInsertSubconRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<SubconRule, "id">) => {
      const { error } = await (supabase as any).from("defect_subcon_rules").insert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBCON_KEY }),
  });
}

export function useUpdateSubconRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<SubconRule>) => {
      const { id, ...patch } = input;
      const { error } = await (supabase as any)
        .from("defect_subcon_rules")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBCON_KEY }),
  });
}

export function useDeleteSubconRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("defect_subcon_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBCON_KEY }),
  });
}