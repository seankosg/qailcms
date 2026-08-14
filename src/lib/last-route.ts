const KEY = "qail-cms:last-route:v1";
// 저장 제외 경로 (리다이렉트 루프 방지)
const EXCLUDED = ["/", "/auth", "/change-password"];

// 라우트 ID(예: /_authenticated/...)는 실제 URL 이 아니므로 404 루프를 만든다.
function isInvalidPath(path: string) {
  return EXCLUDED.includes(path) || path.startsWith("/_");
}

export function saveLastRoute(href: string) {
  if (typeof window === "undefined") return;
  if (!href.startsWith("/")) return;
  const path = href.split("?")[0].split("#")[0];
  if (isInvalidPath(path)) return;
  try {
    window.localStorage.setItem(KEY, href);
  } catch {
    // ignore
  }
}

export function loadLastRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    if (!v || !v.startsWith("/")) return null;
    const path = v.split("?")[0].split("#")[0];
    if (isInvalidPath(path)) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
export function clearLastRoute() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
