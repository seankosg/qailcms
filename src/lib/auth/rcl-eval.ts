/**
 * RCL 표시용 스코프 판정 — 순수 함수.
 *
 * ★두 벌임을 인정하고 관리한다: 서버 `public.rcl_scope_core` 가 정본이고
 * (행 기준 `rcl_scope` · 값 기준 `rcl_scope_of_values` 는 모두 그 하나에 위임한다),
 * 이 함수는 화면 표시 전용 사본이다. 서버 호출을 생략하는 근거로 쓰지 않는다.
 * 세션(auth.uid())에 의존하지 않으므로 임의 계정 기준으로 오프라인 대조가 가능하다
 * (`scripts/rcl-parity-check.ts`).
 */
export interface RclScopeConfig {
  owner_cols: string[] | null;
  team_col: string | null;
  owning_team: string | null;
}

export interface RclUserInfo {
  /** profiles.name */
  my_name: string | null;
  /** profiles.team */
  my_team: string | null;
}

export type RclScope = "own" | "own_team" | "other_team";

/** profiles.name_norm 과 동일 규칙. */
export function normName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** `public.rcl_scope` 와 동일 순서(own → 주관팀 → 행 팀 → other_team). */
export function evalScope(
  cfg: RclScopeConfig | null | undefined,
  user: RclUserInfo | null | undefined,
  row: Record<string, unknown> | null | undefined,
): RclScope | null {
  if (!cfg || !user) return null;
  const me = normName(user.my_name);
  if (row && me) {
    for (const col of cfg.owner_cols ?? []) {
      if (normName(row[col]) === me) return "own";
    }
  }
  const myTeam = normName(user.my_team);
  if (cfg.owning_team && myTeam === normName(cfg.owning_team)) return "own_team";
  if (row && cfg.team_col && myTeam) {
    const rowTeam = normName(row[cfg.team_col]);
    if (rowTeam && rowTeam === myTeam) return "own_team";
  }
  return "other_team";
}