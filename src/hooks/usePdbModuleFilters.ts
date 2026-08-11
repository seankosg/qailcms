import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PDB_DEFAULTS,
  normalizePdbFilters,
  type PdbFilters,
} from "@/lib/dashboards/pdb-filters";

export const PDB_FILTERS_QUERY_KEY = ["pdb-module-filters"] as const;

/** PDB 모듈별 필터 세팅(Admin > Setting 저장값). 미저장 모듈은 기본값. */
export function usePdbModuleFilters() {
  return useQuery({
    queryKey: PDB_FILTERS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<PdbFilters> => {
      const { data, error } = await (supabase as any)
        .from("pdb_module_filters")
        .select("module, filters, updated_at, updated_by");
      if (error) throw new Error(error.message);
      const out: PdbFilters = {
        tm: { ...PDB_DEFAULTS.tm },
        sm: { ...PDB_DEFAULTS.sm },
        abd: { ...PDB_DEFAULTS.abd },
      };
      for (const r of (data ?? []) as Array<{ module: string; filters: unknown }>) {
        if (r.module === "tm") out.tm = normalizePdbFilters("tm", r.filters) as PdbFilters["tm"];
        else if (r.module === "sm") out.sm = normalizePdbFilters("sm", r.filters) as PdbFilters["sm"];
        else if (r.module === "abd") out.abd = normalizePdbFilters("abd", r.filters) as PdbFilters["abd"];
      }
      return out;
    },
  });
}
