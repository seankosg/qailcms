import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  PDB_DEFAULTS,
  normalizePdbFilters,
  type PdbFilters,
} from "@/lib/dashboards/pdb-filters";

export const PDB_FILTERS_QUERY_KEY = ["pdb-module-filters"] as const;

/**
 * PDB 모듈별 필터 세팅 — 계정별 "이 브라우저" 로컬 저장.
 * 로컬 값이 없으면 서버(pdb_module_filters)의 값을 최초 1회 씨앗값으로 읽고,
 * 이후 저장은 로컬에만 하므로 다른 사용자가 세팅을 바꿔도 내 화면은 영향받지 않는다.
 */
function storageKey(userId: string | null) {
  return `qail.pdb-filters:${userId ?? "anon"}`;
}

function normalizeAll(raw: Record<string, unknown> | null | undefined): PdbFilters {
  const o = raw ?? {};
  return {
    tm: normalizePdbFilters("tm", o.tm) as PdbFilters["tm"],
    sm: normalizePdbFilters("sm", o.sm) as PdbFilters["sm"],
    abd: normalizePdbFilters("abd", o.abd) as PdbFilters["abd"],
  };
}

export function readLocalPdbFilters(userId: string | null): PdbFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return normalizeAll(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLocalPdbFilters(userId: string | null, value: PdbFilters) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // 저장 실패는 조용히 무시
  }
}

export function usePdbModuleFilters() {
  const { data: currentUser } = useCurrentUser();
  const userId = currentUser?.id ?? null;

  return useQuery({
    queryKey: [...PDB_FILTERS_QUERY_KEY, userId] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<PdbFilters> => {
      const local = readLocalPdbFilters(userId);
      if (local) return local;
      // 로컬 미보유 → 서버 기본 세팅을 씨앗값으로 사용
      const out: PdbFilters = {
        tm: { ...PDB_DEFAULTS.tm },
        sm: { ...PDB_DEFAULTS.sm },
        abd: { ...PDB_DEFAULTS.abd },
      };
      try {
        const { data, error } = await (supabase as any)
          .from("pdb_module_filters")
          .select("module, filters");
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as Array<{ module: string; filters: unknown }>) {
          if (r.module === "tm") out.tm = normalizePdbFilters("tm", r.filters) as PdbFilters["tm"];
          else if (r.module === "sm") out.sm = normalizePdbFilters("sm", r.filters) as PdbFilters["sm"];
          else if (r.module === "abd") out.abd = normalizePdbFilters("abd", r.filters) as PdbFilters["abd"];
        }
      } catch {
        // 서버 조회 실패 시 기본값 사용
      }
      return out;
    },
  });
}

/** 세팅 저장(로컬 전용) 헬퍼 */
export function useSavePdbModuleFilters() {
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const userId = currentUser?.id ?? null;
  return useCallback(
    (value: PdbFilters) => {
      writeLocalPdbFilters(userId, value);
      qc.setQueryData([...PDB_FILTERS_QUERY_KEY, userId], value);
    },
    [qc, userId],
  );
}
