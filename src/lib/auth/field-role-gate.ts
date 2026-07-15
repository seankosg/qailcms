import type { AppRole } from "@/types/enums";

/**
 * Field-Level Role Gate 판정.
 * - 빈 배열 / null / undefined = 제한 없음(모두 허용)
 * - admin 은 항상 통과
 * - 그 외에는 userRoles 중 하나라도 allowed 에 포함되면 통과
 */
export function isAllowedByRoles(
  allowed: (AppRole | string)[] | null | undefined,
  userRoles: (AppRole | string)[] | null | undefined,
): boolean {
  const list = (allowed ?? []).filter(Boolean);
  if (list.length === 0) return true;
  const roles = new Set((userRoles ?? []).map(String));
  if (roles.has("admin")) return true;
  return list.some((r) => roles.has(String(r)));
}