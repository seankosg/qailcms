import { useCallback, useEffect, useState } from "react";

/**
 * TM 전 페이지가 공유하는 As-of(판정 기준일) 상태 (sessionStorage 기반).
 * - 빈 문자열 = 오늘(Asia/Qatar) 기준 판정
 * - 문자열(YYYY-MM-DD) = 사용자가 지정한 판정 기준일(과거=이력 재판정, 미래=전망)
 * 구 키 `tm_data_date` 는 폐기됨(U5).
 */
const KEY = "tm_as_of";
const LEGACY_KEY = "tm_data_date";

function read(): string {
  if (typeof window === "undefined") return "";
  try {
    // 구 키가 남아 있으면 제거만 하고 값은 승계하지 않는다(As-of 기본값=오늘).
    window.sessionStorage.removeItem(LEGACY_KEY);
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

const listeners = new Set<(v: string) => void>();

function broadcast(v: string) {
  listeners.forEach((fn) => {
    try {
      fn(v);
    } catch {
      /* noop */
    }
  });
}

export function useTmAsOf(): [string, (v: string) => void, () => void] {
  const [value, setValue] = useState<string>(() => read());

  useEffect(() => {
    const fn = (v: string) => setValue(v);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const set = useCallback((v: string) => {
    try {
      if (v) window.sessionStorage.setItem(KEY, v);
      else window.sessionStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    broadcast(v);
  }, []);

  const reset = useCallback(() => set(""), [set]);

  return [value, set, reset];
}
