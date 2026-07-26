import { useCallback, useEffect, useState } from "react";

/**
 * ABD 전 페이지가 공유하는 Data Date 상태 (sessionStorage 기반).
 * TM 의 useTmDataDate 와 동일 패턴.
 * - 빈 문자열/null = 최신(=오늘, Doha 기준) → DB 저장 파생 컬럼 신뢰
 * - "YYYY-MM-DD" = 사용자 지정. 재판정이 필요한 경우 abd_judge_at_date RPC 호출.
 */
const KEY = "abd_data_date";

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
    try { fn(v); } catch { /* noop */ }
  });
}

export function useAbdDataDate(): [string, (v: string) => void, () => void] {
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
