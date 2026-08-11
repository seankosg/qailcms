/**
 * SPL 문서번호 정규화.
 *
 * Aconex Export 에는 유니코드 대시 변종(U+2010 등)이 섞여 들어온다.
 * 정규화 없이는 조용히 미매칭되고, 더 나쁘게는 `-OCS-` 제외 규칙이 뚫린다.
 * 매칭·OCS 판정은 반드시 이 함수를 통과한 문자열로 한다.
 */
const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;

export function normalizeSplNumber(v: unknown): string {
  return String(v ?? "")
    .replace(DASH_VARIANTS, "-")
    .trim()
    .toUpperCase();
}

/** `-OCS-` 는 Aconex 루틴 산출물 — 대시 변종까지 정규화한 뒤 판정한다. */
export function isOcsDocumentNumber(v: unknown): boolean {
  return normalizeSplNumber(v).includes("-OCS-");
}

/** `HDEC-XXX-` 의 세 글자 구간 (없으면 null). */
export function splDisciplineTriple(v: unknown): string | null {
  const m = normalizeSplNumber(v).match(/HDEC-([A-Z]{3})-/);
  return m ? m[1] : null;
}
