import { useCallback, useEffect, useState } from "react";
import { yesterdayInDoha } from "@/lib/time/doha";

/**
 * TM 전 페이지가 공유하는 기준일(cutoff) 상태 (sessionStorage 기반).
 * - 기본값 = 어제(Asia/Qatar). 착수 첫날 하루치 요구 편향(tm_kpi_tplan) 상쇄.
 * - 과거·오늘·미래 모두 선택 가능. 기준일은 계획%와 판정에만 작용하고
 *   실적(actual_progress/start/finish)은 어떤 기준일에서도 원본 그대로다.
 * 구 키 `tm_data_date` · `tm_as_of` 는 폐기됨(값 승계 금지).
 */
const KEY = "tm_cutoff";
const LEGACY_KEYS = ["tm_data_date", "tm_as_of"];

function read(): string {
  if (typeof window === "undefined") return yesterdayInDoha();
  try {
    // 구 키가 남아 있으면 제거만 하고 값은 승계하지 않는다(기본값=어제).
    LEGACY_KEYS.forEach((k) => window.sessionStorage.removeItem(k));
    return window.sessionStorage.getItem(KEY) || yesterdayInDoha();
  } catch {
    return yesterdayInDoha();
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
    const next = v || yesterdayInDoha();
    try {
      window.sessionStorage.setItem(KEY, next);
    } catch {
      /* noop */
    }
    broadcast(next);
  }, []);

  const reset = useCallback(() => set(yesterdayInDoha()), [set]);

  return [value, set, reset];
}
