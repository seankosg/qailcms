// S-Curve 보기 창 유틸 — 계산(누계·모수·버킷 산출)에는 관여하지 않는다.
// 여기서 하는 일은 "보이는 구간"을 줄이고 축 범위를 정하는 것뿐이다.

export type TailTrim = { end: number; trimmed: number };

/**
 * 끝에서부터 계획 증분·실적 증분이 모두 0(또는 null)인 버킷을 잘라낸다.
 * - as-of 버킷보다 앞서 자르지 않는다.
 * - 자른 뒤 8개 미만이 되면 자르지 않는다.
 * 반환값 end 는 "포함 마지막 인덱스 + 1".
 */
export function trimFlatTail(opts: {
  planInc: Array<number | null | undefined>;
  actualInc: Array<number | null | undefined>;
  todayIndex: number;
  minKeep?: number;
  eps?: number;
}): TailTrim {
  const { planInc, actualInc, todayIndex } = opts;
  const minKeep = opts.minKeep ?? 8;
  const eps = opts.eps ?? 1e-9;
  const n = Math.max(planInc.length, actualInc.length);
  if (n === 0) return { end: 0, trimmed: 0 };
  const zero = (v: number | null | undefined) => v == null || Math.abs(v) <= eps;
  let end = n;
  while (end > 0 && zero(planInc[end - 1]) && zero(actualInc[end - 1])) end--;
  // as-of 버킷은 항상 남긴다
  const floor = Math.max(minKeep, todayIndex >= 0 ? todayIndex + 1 : 0);
  if (end < floor) end = Math.min(n, floor);
  if (n - end <= 0) return { end: n, trimmed: 0 };
  return { end, trimmed: n - end };
}

/** windowStart/windowEnd(ISO)로 보이는 구간을 다시 좁힌다. 주지 않으면 그대로. */
export function clampWindow(
  buckets: string[],
  start: number,
  end: number,
  windowStart?: string | null,
  windowEnd?: string | null,
): { start: number; end: number } {
  let s = start;
  let e = end;
  if (windowStart) {
    while (s < e && buckets[s] < windowStart) s++;
  }
  if (windowEnd) {
    while (e > s && buckets[e - 1] > windowEnd) e--;
  }
  return { start: s, end: e };
}

/** 증분 막대가 차트 높이의 절반을 넘지 않도록 우측 축 최대값을 잡는다. */
export function incAxisMax(values: Array<number | null | undefined>): number {
  let max = 0;
  for (const v of values) if (v != null && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  if (max <= 0) return 1;
  const doubled = max * 2;
  const mag = Math.pow(10, Math.floor(Math.log10(doubled)));
  return Math.ceil(doubled / (mag / 2)) * (mag / 2);
}

/** 부호 있는 변동 축 — 0 을 반드시 포함한다. */
export function signedDomain(values: Array<number | null | undefined>): [number, number] {
  let min = 0;
  let max = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (min === 0 && max === 0) return [0, 1];
  return [min, max];
}

/** 라벨 개수를 줄인다(반폭 카드 기준 6~8개). */
export function pickXTicks(labels: string[], maxTicks = 7): string[] {
  if (labels.length <= maxTicks) return labels;
  const step = Math.ceil(labels.length / maxTicks);
  const out = labels.filter((_, i) => i % step === 0);
  const last = labels[labels.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
