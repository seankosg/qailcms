import { ROLE_RANK, type AppRole } from "@/types/enums";

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

type RawTable =
  | "abd_items_raw"
  | "defect_items_raw"
  | "task_management_raw";

/**
 * Raw 행 편집 사전 판정 (클라이언트).  서버는 반드시 assertCanEdit 로 재검증.
 * - rank ≥ senior_user : 전체 편집
 * - user               : PIC 규칙(내 이름과 일치하는 행)
 * - d_superuser        : team 일치 시 편집
 * - 그 외              : 편집 불가
 */
export function canEditRawRow(
  user: MinimalUser | null | undefined,
  _table: RawTable,
  row: Record<string, any> | null | undefined,
): boolean {
  if (!user || !row) return false;
  if (hasRank(user, "senior_user")) return true;
  const roles = normalizeRoles(user.roles);
  if (roles.includes("d_superuser")) {
    const rt = (row.team ?? "").toString().toUpperCase();
    const ut = (user.team ?? "").toString().toUpperCase();
    return !!rt && !!ut && rt === ut;
  }
  if (roles.includes("user")) {
    const candidates: Array<[string | null | undefined, string | null | undefined]> = [
      [user.hdec_pic_name, row.hdec_pic_name],
      [user.hdec_eng_name, row.hdec_eng_name],
      [user.subcontractor_name, row.subcontractor_name],
      [user.subsub_name, row.subsub_name],
    ];
    return candidates.some(
      ([u, r]) => !!u && !!r && String(u).trim() === String(r).trim(),
    );
  }
  return false;
}