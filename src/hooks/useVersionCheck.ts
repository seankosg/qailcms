import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 60_000;
const SESSION_DISMISS_KEY = "qail-cms:version-dismissed";

function getCurrentBuildId(): string {
  const fromDefine =
    typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
  if (fromDefine) return fromDefine;
  const fromEnv =
    typeof import.meta !== "undefined"
      ? import.meta.env?.VITE_APP_BUILD_ID
      : undefined;
  return typeof fromEnv === "string" ? fromEnv : "";
}

function isDevBuild(id: string) {
  return !id || id === "development" || id.startsWith("__");
}

let toastShownForBuildId: string | null = null;

export async function forceFreshAppLoad() {
  if (typeof window === "undefined") return;

  try {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // ignore cache API failures and still navigate with a cache-busting URL
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // ignore service worker failures and still navigate with a cache-busting URL
  }

  const url = new URL(window.location.href);
  url.searchParams.set("__reset", String(Date.now()));
  window.location.replace(url.toString());
}

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
          if (toastShownForBuildId !== remote && dismissed !== remote) {
            toastShownForBuildId = remote;
            toast("새 버전이 배포되었습니다", {
              description:
                "우측 상단의 New Version 버튼 또는 상단 배너의 '지금 새로고침'을 눌러 주세요.",
              duration: Infinity,
              closeButton: true,
              action: {
                label: "지금 새로고침",
                onClick: () => void forceFreshAppLoad(),
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
    void forceFreshAppLoad();
  }, []);

  return { updateAvailable, latestBuildId, dismiss, reloadNow };
}