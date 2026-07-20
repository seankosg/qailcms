/**
 * Payload에서 null/undefined 값을 제거해 upsert 시 기존 DB 값을 유지한다.
 * `force` 목록에 있는 키는 null이라도 그대로 유지 (강제 기록/자동계산 리셋 용).
 */
export function stripNullExcept<T extends Record<string, unknown>>(
  obj: T,
  force: readonly (keyof T | string)[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  const forceSet = new Set(force as string[]);
  for (const [k, v] of Object.entries(obj)) {
    if (forceSet.has(k)) {
      out[k] = v;
      continue;
    }
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}