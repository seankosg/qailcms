import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { evalScope, type RclScope } from "@/lib/auth/rcl-eval";

export type RclModule = "TM" | "ABD" | "SM" | "SPL" | "WRT";
export type RclAction = "read" | "write" | "delete" | "import" | "export";

export interface RclGrants {
  module: string;
  action: string;
  role: string | null;
  own: boolean;
  own_team: boolean;
  other_team: boolean;
  owner_cols: string[] | null;
  team_col: string | null;
  owning_team: string | null;
  my_team: string | null;
  my_name: string | null;
}

/**
 * RCL 정본 판정 — 서버 권한표(`rcl_permissions`) + 모듈 설정(`rcl_module_config`)을
 * `rcl_grants` RPC 하나로 받아 화면 판정에 그대로 사용한다.
 *
 * 클라이언트는 규칙을 재구현하지 않는다. 여기서 하는 일은 서버가 내려준
 * scope별 허용값(own / own_team / other_team)에 서버가 내려준
 * owner_cols·team_col·owning_team 을 대입하는 것뿐이며, 이는
 * `public.rcl_scope` 의 판정 순서와 1:1 대응한다.
 *
 * 어드민 권한 격자를 바꾸면 캐시 없이(staleTime 0) 즉시 반영된다.
 */
export function useRclGrants(module: RclModule, action: RclAction) {
  return useQuery({
    queryKey: ["rcl-grants", module, action],
    queryFn: async (): Promise<RclGrants> => {
      const { data, error } = await (supabase as any).rpc("rcl_grants", {
        _module: module,
        _action: action,
      });
      if (error) throw new Error(`권한 조회 실패(${module}/${action}): ${error.message}`);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`권한 응답 형식 오류(${module}/${action})`);
      }
      return data as RclGrants;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * `rcl_scope` 와 동일 순서로 행의 scope 를 판정한다(표시 전용 사본).
 * 판정 본체는 순수 함수 `evalScope` 이며, 세션 없이 대조 스크립트에서 재사용된다.
 */
export function rclScopeOfRow(
  g: RclGrants | null | undefined,
  row: Record<string, unknown> | null | undefined,
): RclScope {
  if (!g) return "other_team";
  return (
    evalScope(
      { owner_cols: g.owner_cols, team_col: g.team_col, owning_team: g.owning_team },
      { my_name: g.my_name, my_team: g.my_team },
      row,
    ) ?? "other_team"
  );
}

export function rclAllows(
  g: RclGrants | null | undefined,
  row: Record<string, unknown> | null | undefined,
): boolean {
  if (!g || !g.role) return false;
  const scope = rclScopeOfRow(g, row);
  return scope === "own" ? g.own : scope === "own_team" ? g.own_team : g.other_team;
}

/**
 * 화면용 행 편집 판정자.
 * `canRow(row)` 는 서버 `rcl_can(uid, module, row.id, action)` 과 동일 결과를 낸다.
 * `anyScope` 는 "이 사용자가 이 모듈에서 어떤 행이든 편집할 여지가 있는가" —
 * 벌크 편집 바 같은 진입 게이트에 쓴다(행 필터는 별도로 `canRow` 로 적용).
 */
export function useRclCan(module: RclModule, action: RclAction = "write") {
  const { data: grants, isLoading } = useRclGrants(module, action);
  const canRow = useCallback(
    (row: Record<string, unknown> | null | undefined) => rclAllows(grants, row),
    [grants],
  );
  const anyScope = !!grants?.role && (grants.own || grants.own_team || grants.other_team);
  return { grants: grants ?? null, canRow, anyScope, isLoading };
}

/**
 * 선택된 행 집합에 대한 서버 일괄 재판정 (최대 2000행).
 * 벌크 편집 "적용 N건 / 제외 M건" 표시가 서버 판정과 정확히 일치하도록 쓴다.
 */
export async function rclCanRows(
  module: RclModule,
  rowIds: string[],
  action: RclAction = "write",
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < rowIds.length; i += 2000) {
    const chunk = rowIds.slice(i, i + 2000);
    const { data, error } = await (supabase as any).rpc("rcl_can_rows", {
      _module: module,
      _row_ids: chunk,
      _action: action,
    });
    if (error) throw new Error(`권한 일괄 판정 실패(${module}): ${error.message}`);
    for (const id of ((data as any)?.allowed ?? []) as string[]) out.add(id);
  }
  return out;
}