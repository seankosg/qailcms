/**
 * ABD 임포트 모드 전환 시 파일 큐 핸드오프.
 *
 * 사용 흐름:
 *   1) HDEC 페이지에서 소스 가드가 Aconex 파일 감지 → 사용자 "Aconex 로 전환" 선택.
 *   2) HDEC 페이지가 setMode('aconex') 를 호출하고 곧바로 emitAbdImportHandoff('aconex', files).
 *   3) Aconex 페이지는 마운트 시 subscribeAbdImportHandoff('aconex') 로 파일을 수신 →
 *      바로 handleFiles 에 위임 (헤더 지문은 소스가 확정된 상태라 재검증 생략).
 *
 * subscribe 이전에 emit 이 발생하면 pending 버퍼에 담아두었다가 첫 구독 시점에 flush.
 */

type Mode = "hdec" | "aconex";
type Listener = (files: File[]) => void;

const listeners: Record<Mode, Set<Listener>> = {
  hdec: new Set(),
  aconex: new Set(),
};
const pending: Record<Mode, File[]> = { hdec: [], aconex: [] };

export function subscribeAbdImportHandoff(mode: Mode, fn: Listener): () => void {
  listeners[mode].add(fn);
  if (pending[mode].length > 0) {
    const buf = pending[mode].splice(0, pending[mode].length);
    // 다음 tick 에서 호출 — 구독자가 마운트 직후 초기 이펙트를 마치도록 대기.
    queueMicrotask(() => fn(buf));
  }
  return () => {
    listeners[mode].delete(fn);
  };
}

export function emitAbdImportHandoff(mode: Mode, files: File[]): void {
  if (files.length === 0) return;
  const subs = listeners[mode];
  if (subs.size > 0) {
    for (const fn of subs) fn(files);
  } else {
    pending[mode].push(...files);
  }
}