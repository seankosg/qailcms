import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MasterKind = "subcontractor" | "subsub" | "hdec_pic" | "hdec_eng";

export interface MasterOption {
  id: string;
  name: string;
}

export const MASTER_OPTIONS_QK = (kind: MasterKind) =>
  ["master-options", kind] as const;

/**
 * Import 파이프라인에서 유사 매칭에 사용하는 마스터 옵션(활성만) 조회.
 * subcontractor / subsub 은 `subcontractor_master.type` 으로 구분.
 */
export function useMasterOptions(kind: MasterKind) {
  return useQuery({
    queryKey: MASTER_OPTIONS_QK(kind),
    queryFn: async (): Promise<MasterOption[]> => {
      if (kind === "hdec_pic") {
        const { data, error } = await supabase
          .from("hdec_pic_master")
          .select("id,name")
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        return (data ?? []) as MasterOption[];
      }
      if (kind === "hdec_eng") {
        const { data, error } = await (supabase as any)
          .from("hdec_eng_master")
          .select("id,name")
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        return (data ?? []) as MasterOption[];
      }
      const type = kind === "subsub" ? "subsub" : "sub";
      const { data, error } = await (supabase as any)
        .from("subcontractor_master")
        .select("id,name")
        .eq("type", type)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as MasterOption[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAllMasterOptions() {
  const subcontractor = useMasterOptions("subcontractor");
  const subsub = useMasterOptions("subsub");
  const hdecPic = useMasterOptions("hdec_pic");
  const hdecEng = useMasterOptions("hdec_eng");
  return {
    subcontractor: subcontractor.data ?? [],
    subsub: subsub.data ?? [],
    hdec_pic: hdecPic.data ?? [],
    hdec_eng: hdecEng.data ?? [],
    isLoading:
      subcontractor.isLoading ||
      subsub.isLoading ||
      hdecPic.isLoading ||
      hdecEng.isLoading,
  };
}