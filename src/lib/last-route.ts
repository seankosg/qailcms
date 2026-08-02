const KEY = "qail-cms:last-route:v1";
// 저장 제외 경로 (리다이렉트 루프 방지)
const EXCLUDED = ["/", "/auth", "/change-password"];

export function saveLastRoute(href: string) {
  if (typeof window === "undefined") return;
  if (!href.startsWith("/")) return;
  const path = href.split("?")[0].split("#")[0];
  if (EXCLUDED.includes(path)) return;
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
    return EXCLUDED.includes(path) ? null : v;
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
