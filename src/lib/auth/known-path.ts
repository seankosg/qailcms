import type { AnyRouter } from "@tanstack/react-router";

/**
 * 라우터에 실제로 존재하는 경로인지 판정한다.
 * 구버전 경로(예: /closeout/dashboard)가 localStorage 에 남아 404 로 이동하는 것을 막는다.
 */
export function makeIsKnownPath(router: AnyRouter): (path: string) => boolean {
  return (path: string) => {
    try {
      const matches = router.matchRoutes(path, {});
      if (!matches?.length) return false;
      const last = matches[matches.length - 1];
      const id = String(last.routeId ?? "");
      // 매칭 실패 시 루트/notFound 로만 떨어진다.
      return id !== "__root__" && !id.includes("404");
    } catch {
      return false;
    }
  };
}
