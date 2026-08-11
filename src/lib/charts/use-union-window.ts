import { useCallback, useRef, useState } from "react";

export type ResolvedWindow = { start: string | null; end: string | null };

/**
 * 나란히 놓인 차트들의 실제 창(절단 후)을 모아 합집합을 돌려준다.
 * - 카드가 onWindowResolved(start, end) 로 자기 창을 알려주면 여기서 min/max 를 잡는다.
 * - 값이 바뀌지 않으면 state 를 갱신하지 않는다(재렌더 루프 방지).
 */
export function useUnionWindow() {
  const [window, setWindow] = useState<ResolvedWindow>({ start: null, end: null });
  const seen = useRef<Record<string, { s: string; e: string }>>({});

  const report = useCallback((key: string, s: string, e: string) => {
    const prev = seen.current[key];
    if (prev && prev.s === s && prev.e === e) return;
    seen.current[key] = { s, e };
    const vals = Object.values(seen.current);
    if (vals.length === 0) return;
    let start = vals[0].s;
    let end = vals[0].e;
    for (const v of vals) {
      if (v.s < start) start = v.s;
      if (v.e > end) end = v.e;
    }
    setWindow((cur) => (cur.start === start && cur.end === end ? cur : { start, end }));
  }, []);

  return { window, report };
}
