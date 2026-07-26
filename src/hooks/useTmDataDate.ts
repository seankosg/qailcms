import { useCallback, useEffect, useState } from "react";

/**
 * TM 전 페이지가 공유하는 Data Date 상태 (sessionStorage 기반).
 * - null/빈 문자열 = "최신 Data Date" (DB의 저장된 파생 컬럼을 그대로 사용)
 * - 문자열(YYYY-MM-DD) = 사용자가 지정한 특정 Data Date.
 *   호출자는 이 값을 tm_judge_at_date RPC 에 넘겨 즉석 재판정 결과를 사용해야 함.
 */
const KEY = "tm_data_date";

function read(): string {
  if (typeof window === "undefined") return "";
  try {
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

export function useTmDataDate(): [string, (v: string) => void, () => void] {
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
