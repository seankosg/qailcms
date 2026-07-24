import { useCallback, useMemo } from "react";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";

export interface MwsColumnPrefsState {
  order: string[];
  visibility: Record<string, boolean>;
  frozen: string[];
}

export interface MwsColumnPrefs extends MwsColumnPrefsState {
  setOrder: (next: string[]) => void;
  setVisibility: (next: Record<string, boolean>) => void;
  setFrozen: (next: string[]) => void;
  ready: boolean;
}

/**
 * MWS 리스트박스 컬럼 설정 (order / visibility / frozen) 을 계정 단위로 서버 저장.
 * 서버 값 도착 시 defaults 와 병합하여 새/삭제 키를 보정합니다.
 */
export function useMwsColumnPrefs(viewKey: string, defaults: MwsColumnPrefsState): MwsColumnPrefs {
  const { state, ready, save } = useUserViewPreference(viewKey);

  const merged = useMemo<MwsColumnPrefsState>(() => {
    const raw = (state ?? {}) as Partial<MwsColumnPrefsState>;
    const knownKeys = new Set(defaults.order);
    // order: 서버값 중 유효 키만 유지 + defaults 에서 누락된 키를 뒤에 추가
    const serverOrder = Array.isArray(raw.order) ? raw.order.filter((k) => knownKeys.has(k)) : [];
    const missing = defaults.order.filter((k) => !serverOrder.includes(k));
    const order = serverOrder.length ? [...serverOrder, ...missing] : [...defaults.order];
    // visibility: 알려진 키에만 반영, 없으면 default (true 로 가정)
    const vis: Record<string, boolean> = { ...defaults.visibility };
    if (raw.visibility && typeof raw.visibility === "object") {
      for (const k of Object.keys(raw.visibility)) {
        if (knownKeys.has(k)) vis[k] = !!(raw.visibility as Record<string, unknown>)[k];
      }
    }
    // frozen: 유효 키만
    const frozen = Array.isArray(raw.frozen)
      ? raw.frozen.filter((k) => knownKeys.has(k))
      : [...defaults.frozen];
    // defaults 에서 강제 frozen (예: __ctx) 은 항상 포함
    for (const f of defaults.frozen) if (!frozen.includes(f)) frozen.unshift(f);
    return { order, visibility: vis, frozen };
  }, [state, defaults]);

  const persist = useCallback(
    (next: MwsColumnPrefsState) => {
      save(next as unknown as Record<string, unknown>);
    },
    [save],
  );

  const setOrder = useCallback(
    (next: string[]) => persist({ ...merged, order: next }),
    [merged, persist],
  );
  const setVisibility = useCallback(
    (next: Record<string, boolean>) => persist({ ...merged, visibility: next }),
    [merged, persist],
  );
  const setFrozen = useCallback(
    (next: string[]) => {
      // defaults.frozen (강제 고정) 항목은 제거 불가
      const forced = new Set(defaults.frozen);
      const cleaned = next.filter((k) => !forced.has(k));
      persist({ ...merged, frozen: [...defaults.frozen, ...cleaned] });
    },
    [merged, persist, defaults.frozen],
  );

  return { ...merged, setOrder, setVisibility, setFrozen, ready };
}