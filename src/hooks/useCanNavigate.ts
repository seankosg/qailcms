import { useCallback } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessPath } from "@/lib/auth/route-access";

/**
 * 화면 링크 판정자 — 라우트 가드(@/lib/auth/route-access)와 같은 정본을 쓴다.
 * Guest 는 모듈 Dashboard 외 경로로 나가는 링크를 클릭할 수 없다.
 */
export function useCanNavigate() {
  const { data: me } = useCurrentUser();
  const flags = {
    isGuest: me?.primaryRole === "guest" || (!!me && !me.primaryRole),
    isSuperGuest: me?.primaryRole === "super_guest",
  };
  return useCallback((path: string) => canAccessPath(flags, path), [flags.isGuest, flags.isSuperGuest]);
}
