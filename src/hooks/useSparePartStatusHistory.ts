import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StatusCategory = "technical" | "supplier" | "internal" | "general";
export type StatusSource = "migration" | "excel_import" | "app_manual";

export interface StatusHistoryRow {
  id: string;
  doc_ref: string;
  parent_comment_id: string | null;
  category: StatusCategory;
  message: string;
  source: StatusSource;
  source_file_hash: string | null;
  author_user_id: string | null;
  edited: boolean;
  created_at: string;
  updated_at: string;
}

export function statusHistoryQK(docRef: string) {
  return ["spare-part-status-history", docRef] as const;
}

export function useSparePartStatusHistory(docRef: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: statusHistoryQK(docRef ?? ""),
    enabled: !!docRef,
    queryFn: async (): Promise<StatusHistoryRow[]> => {
      const { data, error } = await (supabase as any)
        .from("spare_part_status_history")
        .select("*")
        .eq("doc_ref", docRef!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as StatusHistoryRow[];
    },
  });

  useEffect(() => {
    if (!docRef) return;
    const channel = supabase
      .channel(`sp-status-history-${docRef}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "spare_part_status_history", filter: `doc_ref=eq.${docRef}` },
        () => qc.invalidateQueries({ queryKey: statusHistoryQK(docRef) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [docRef, qc]);

  return q;
}