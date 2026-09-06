/**
 * Guest / Super Guest 화면 접근 정책 정본 (2026-09-06 지시자 확정).
 *
 * - Guest       : 각 모듈의 Dashboard 페이지만 접근.
 * - Super Guest : 조회 페이지 전부 접근, 관리(쓰기) 페이지 및 Admin 차단.
 * - 그 외 역할  : 이 파일은 관여하지 않는다(기존 가드 유지).
 *
 * 라우트 가드 · 사이드바 · 드릴다운 링크가 모두 이 판정 하나를 쓴다.
 * 여기에 규칙을 재구현하면 "보이는 것"과 "들어갈 수 있는 것"이 갈라지므로 금지.
 */

export type RouteTier = "dashboard" | "read" | "manage" | "admin";

export interface RouteRoleFlags {
  isGuest?: boolean;
  isSuperGuest?: boolean;
}

/** Guest 도 접근 가능한 대시보드 경로. */
const DASHBOARD_PATHS = [
  "/closure/task-management/dashboard",
  "/closure/snag-management/dashboard",
  "/closure/abd/dashboard",
  "/closure/spare-part/dashboard",
  "/closure/dashboard",
  "/resource/dashboard",
  "/resource/dmr/dashboard",
];

/** Super Guest 도 차단되는 관리(쓰기) 경로. */
const MANAGE_PREFIXES = [
  "/import-log",
  "/closure/task-management/import",
  "/closure/snag-management/import",
  "/closure/abd/import",
  "/closure/snag-management/settings",
  "/closure/task-management/schedule-revision",
  "/resource/dmr/entry",
];

/** Guest 차단 시 도착지 (첫 화면 겸용). */
export const GUEST_HOME = "/closure/task-management/dashboard";
/** Super Guest 차단 시 도착지. */
export const SUPER_GUEST_HOME = "/project-dashboard";

function startsWithSegment(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function routeAccessTier(pathname: string): RouteTier {
  const path = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";
  if (startsWithSegment(path, "/admin")) return "admin";
  if (MANAGE_PREFIXES.some((p) => startsWithSegment(path, p))) return "manage";
  if (DASHBOARD_PATHS.some((p) => startsWithSegment(path, p))) return "dashboard";
  return "read";
}

/** 해당 역할이 이 경로에 진입할 수 있는가. guest/super_guest 외에는 항상 true. */
export function canAccessPath(flags: RouteRoleFlags | null | undefined, pathname: string): boolean {
  if (!flags) return true;
  const tier = routeAccessTier(pathname);
  if (flags.isGuest) return tier === "dashboard";
  if (flags.isSuperGuest) return tier === "dashboard" || tier === "read";
  return true;
}

/** 차단 시 리다이렉트 대상. */
export function accessFallbackPath(flags: RouteRoleFlags | null | undefined): string {
  if (flags?.isGuest) return GUEST_HOME;
  return SUPER_GUEST_HOME;
}
