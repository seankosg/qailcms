import { ROLE_RANK, type AppRole } from "@/types/enums";

/** 사용자 식별 정본 키 정규화 (DB profiles.name_norm 과 동일 규칙). */
export function normalizeUserName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export interface MinimalUser {
  roles?: AppRole[] | string[];
  rank?: number;
  team?: string | null;
  subcontractor_name?: string | null;
  subsub_name?: string | null;
  hdec_pic_name?: string | null;
  hdec_eng_name?: string | null;
  name?: string | null;
}

export function normalizeRoles(roles: (AppRole | string)[] | undefined): AppRole[] {
  return (roles ?? []).filter((r): r is AppRole => r in ROLE_RANK);
}

export function highestRank(roles: (AppRole | string)[] | undefined): number {
  const rs = normalizeRoles(roles);
  return rs.reduce((m, r) => Math.max(m, ROLE_RANK[r] ?? 0), 0);
}

/**
 * 표시·정렬용 최고 등급. DB rcl_highest_role 과 동일 서열(ROLE_RANK)을 사용한다.
 * user_roles 는 (user_id, role) UNIQUE 이므로 한 사람이 복수 행을 가질 수 있고,
 * 실제 판정은 항상 최고 등급으로 돈다 → 화면도 같은 기준이어야 한다.
 */
export function highestRole(
  roles: (AppRole | string)[] | undefined,
  fallback: AppRole = "guest",
): AppRole {
  const rs = normalizeRoles(roles);
  if (rs.length === 0) return fallback;
  return rs.reduce((best, r) => (ROLE_RANK[r] > ROLE_RANK[best] ? r : best), rs[0]!);
}

export function hasRank(
  user: MinimalUser | null | undefined,
  minRole: AppRole,
): boolean {
  if (!user) return false;
  const rank = user.rank ?? highestRank(user.roles);
  return rank >= ROLE_RANK[minRole];
}

export function isAdmin(user: MinimalUser | null | undefined): boolean {
  const rs = normalizeRoles(user?.roles);
  return rs.includes("admin") || rs.includes("superuser");
}

export function isDSuperUser(user: MinimalUser | null | undefined): boolean {
  return normalizeRoles(user?.roles).includes("d_superuser");
}

/**
 * 라우트 경로별 최소 요구 rank / role.
 * Phase 5 에서 완전 이행. 현재는 admin 경로만 강제.
 */
export function canAccessRoute(
  user: MinimalUser | null | undefined,
  path: string,
): boolean {
  if (!user) return false;
  if (path.startsWith("/admin")) return isAdmin(user);
  // d_superuser 는 admin 을 제외한 모든 경로 접근 가능
  return true;
}

/**
 * ⚠️ 행 단위 편집 판정은 이 파일에 두지 않는다.
 *
 * 판정 정본은 DB `public.rcl_can` 하나뿐이며, 화면은 `@/hooks/useRclCan`
 * (`rcl_grants` RPC)을 통해 서버 권한표를 그대로 사용한다.
 * 여기에 규칙을 다시 구현하면 "화면에 보이는 것"과 "서버가 허용하는 것"이
 * 갈라지므로 금지한다.
 */