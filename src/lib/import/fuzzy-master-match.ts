/**
 * 유사 이름 매칭 유틸리티.
 * Subcontractor / Sub-Sub / HDEC PIC / Eng 등 이름 컬럼의
 * 오타/공백/전각 차이를 완화하기 위한 편집거리 기반 매칭.
 */

export interface MasterCandidate {
  option: { id: string; name: string };
  score: number;
}

export interface MasterMatchResult {
  exact: { id: string; name: string } | null;
  candidates: MasterCandidate[];
}

/** 전각→반각, 다중 공백 축약, trim, casefold. */
export function normalizeName(s: string | null | undefined): string {
  if (s == null) return "";
  // 전각 영숫자·기호(U+FF01–U+FF5E)를 반각으로 변환
  const halfwidth = String(s).replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return halfwidth
    .replace(/\u3000/g, " ") // 전각 공백
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Levenshtein 편집거리 (O(m*n) 반복 DP, 2행 버퍼). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 0..1 유사도 (1 = 완전 일치). */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

/**
 * raw 이름을 마스터 옵션에 매칭.
 * 1. 정규화 후 정확 일치 → exact
 * 2. 짧은 문자열(≤4)은 편집거리 ≤1 만 후보로 인정
 * 3. 그 외에는 similarity ≥ threshold 후보를 상위 3개까지 반환
 */
export function matchMasterName(
  raw: string | null | undefined,
  options: readonly { id: string; name: string }[],
  opts: { threshold?: number } = {},
): MasterMatchResult {
  const threshold = opts.threshold ?? 0.85;
  const norm = normalizeName(raw);
  if (!norm) return { exact: null, candidates: [] };

  for (const o of options) {
    if (normalizeName(o.name) === norm) {
      return { exact: { id: o.id, name: o.name }, candidates: [] };
    }
  }

  const short = norm.length <= 4;
  const scored: MasterCandidate[] = [];
  for (const o of options) {
    const s = similarity(raw ?? "", o.name);
    if (short) {
      const dist = levenshtein(norm, normalizeName(o.name));
      if (dist <= 1) scored.push({ option: { id: o.id, name: o.name }, score: s });
    } else if (s >= threshold) {
      scored.push({ option: { id: o.id, name: o.name }, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { exact: null, candidates: scored.slice(0, 3) };
}