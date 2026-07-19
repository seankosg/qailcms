import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 60_000;
const SESSION_DISMISS_KEY = "qail-cms:version-dismissed";

function getCurrentBuildId(): string {
  return typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
}

function isDevBuild(id: string) {
  return !id || id === "development" || id.startsWith("__");
}

let toastShown = false;

export function useVersionCheck() {
  const [latestBuildId, setLatestBuildId] = useState<string | null>(null);
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY);
  });

  useEffect(() => {
    const current = getCurrentBuildId();
    if (isDevBuild(current)) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/public/version", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { buildId?: string };
        const remote = json.buildId ?? "";
        if (cancelled || !remote || isDevBuild(remote)) return;
        if (remote !== current) {
          setLatestBuildId((prev) => (prev === remote ? prev : remote));
          const dismissed =
            typeof window !== "undefined"
              ? window.sessionStorage.getItem(SESSION_DISMISS_KEY)
              : null;
          if (!toastShown && dismissed !== remote) {
            toastShown = true;
            toast("새 버전이 배포되었습니다", {
              description:
                "우측 상단의 New Version 버튼 또는 상단 배너의 '지금 새로고침'을 눌러 주세요.",
              duration: Infinity,
              closeButton: true,
              action: {
                label: "지금 새로고침",
                onClick: () => {
                  window.location.replace(
                    window.location.pathname + "?__reset=" + Date.now(),
                  );
                },
              },
            });
          }
        }
      } catch {
        // ignore transient errors
      }
    };

    void check();
    const interval = window.setInterval(check, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const updateAvailable =
    !!latestBuildId && latestBuildId !== dismissedBuildId;

  const dismiss = useCallback(() => {
    if (!latestBuildId || typeof window === "undefined") return;
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, latestBuildId);
    setDismissedBuildId(latestBuildId);
  }, [latestBuildId]);

  const reloadNow = useCallback(() => {
    window.location.replace(
      window.location.pathname + "?__reset=" + Date.now(),
    );
  }, []);

  return { updateAvailable, latestBuildId, dismiss, reloadNow };
}