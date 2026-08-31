import { loadLastRoute } from "@/lib/last-route";

/**
 * 로그인 직후 이동할 경로를 결정한다.
 * §3-1(2026-08-04): QAQC 프론트 제한 폐기 — 마지막 경로 또는 MWS.
 */
export async function resolveLandingRoute(
  _userId: string,
  isKnownPath?: (path: string) => boolean,
): Promise<string> {
  return loadLastRoute(isKnownPath) ?? "/my-work-space";
}
