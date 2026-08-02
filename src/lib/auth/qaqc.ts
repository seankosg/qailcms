/**
 * QAQC 팀 소속 HDEC PIC / HDEC ENG 사용자 제한 규칙.
 * - Admin / Superuser 를 제외하고 Close-Out Doc 섹션만 접근 가능
 * - 모든 편집 권한 차단 (읽기 전용)
 * - 다른 모든 조건을 override
 */
export function isQaqcRestricted(params: {
  team?: string | null;
  userType?: string | null;
  roles?: (string | null | undefined)[] | null;
}): boolean {
  const team = (params.team ?? "").trim().toUpperCase();
  const userType = (params.userType ?? "").trim();
  const roles = new Set((params.roles ?? []).filter(Boolean).map(String));
  if (roles.has("admin") || roles.has("superuser")) return false;
  if (team !== "QAQC") return false;
  return userType === "hdec_pic" || userType === "hdec_eng";
}

/** QAQC 제한 사용자가 접근 가능한 경로 prefix 목록. */
export const QAQC_ALLOWED_PREFIXES = [
  "/closeout",
  "/closure/abd",
  "/closure/warranty",
  "/closure/spare-part",
  "/change-password",
];

export const QAQC_HOME = "/closeout/dashboard";

export function isQaqcAllowedPath(pathname: string): boolean {
  return QAQC_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
