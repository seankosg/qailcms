import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TeamOption {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  aliases: string[];
}

export const TEAM_OPTIONS_QK = ["team-master", "active"] as const;

export function useTeamOptions() {
  return useQuery({
    queryKey: TEAM_OPTIONS_QK,
    queryFn: async (): Promise<TeamOption[]> => {
      const { data, error } = await (supabase as any)
        .from("team_master")
        .select("id,code,name,sort_order,is_active,aliases")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((o) => ({ ...o, aliases: o.aliases ?? [] })) as TeamOption[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAllTeamOptions() {
  return useQuery({
    queryKey: ["team-master", "all"] as const,
    queryFn: async (): Promise<TeamOption[]> => {
      const { data, error } = await (supabase as any)
        .from("team_master")
        .select("id,code,name,sort_order,is_active,aliases")
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((o) => ({ ...o, aliases: o.aliases ?? [] })) as TeamOption[];
    },
    staleTime: 5 * 60_000,
  });
}

/** 대문자 정규화, 빈 값 → null. */
export function normalizeTeamCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return s === "" ? null : s;
}

/** 대소문자 무관 코드/별칭 매칭. 매칭 실패 시 null. */
export function matchTeamCode(
  raw: string | null | undefined,
  options: TeamOption[] | undefined,
): TeamOption | null {
  const code = normalizeTeamCode(raw);
  if (!code || !options?.length) return null;
  const byCode = options.find((o) => o.code.toUpperCase() === code);
  if (byCode) return byCode;
  return options.find((o) =>
    (o.aliases ?? []).some((a) => String(a).trim().toUpperCase() === code),
  ) ?? null;
}

/** 파일명/시트명 등 임의 텍스트에서 코드 또는 별칭이 포함되는지 검사. */
export function detectTeamFromText(
  text: string | null | undefined,
  options: TeamOption[] | undefined,
): TeamOption | null {
  if (!text || !options?.length) return null;
  const upper = String(text).toUpperCase();
  // 코드 우선(길이 내림차순으로 부분문자열 충돌 최소화)
  const sorted = [...options].sort((a, b) => b.code.length - a.code.length);
  for (const o of sorted) {
    if (upper.includes(o.code.toUpperCase())) return o;
  }
  // 별칭 검색: 원문(대문자 아닌 케이스 포함) 및 대문자화 문자열 모두 검사 → 한글 별칭 대응
  const original = String(text);
  for (const o of sorted) {
    for (const a of o.aliases ?? []) {
      const aliasStr = String(a).trim();
      if (!aliasStr) continue;
      if (original.includes(aliasStr)) return o;
      if (upper.includes(aliasStr.toUpperCase())) return o;
    }
  }
  return null;
}