import { useCallback, useEffect, useState } from "react";

/**
 * SM(Snag) 전 페이지가 공유하는 As-of(판정 기준일) 상태 — sessionStorage 기반.
 * TM useTmAsOf / ABD useAbdDataDate 와 동일 패턴.
 * - "" (빈 값) = 오늘(Asia/Qatar)
 * - "YYYY-MM-DD" = 사용자 지정(과거 회고 / 미래 전망)
 */
const KEY = "snag_as_of";
const LEGACY_KEYS = ["snag_data_date", "defect_data_date"];

function read(): string {
  if (typeof window === "undefined") return "";
  try {
    LEGACY_KEYS.forEach((k) => window.sessionStorage.removeItem(k));
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

const listeners = new Set<(v: string) => void>();
function broadcast(v: string) {
  listeners.forEach((fn) => {
    try { fn(v); } catch { /* noop */ }
  });
}

export function useSnagAsOf(): [string, (v: string) => void, () => void] {
  const [value, setValue] = useState<string>(() => read());
  useEffect(() => {
    const fn = (v: string) => setValue(v);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const set = useCallback((v: string) => {
    try {
      if (v) window.sessionStorage.setItem(KEY, v);
      else window.sessionStorage.removeItem(KEY);
    } catch { /* noop */ }
    broadcast(v);
  }, []);
  const reset = useCallback(() => set(""), [set]);
  return [value, set, reset];
}
