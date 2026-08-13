/**
 * ABD/OCS 번호 정규화 — 서버·브라우저 공용 정본.
 *
 * 서버 최종 해소(resolve)는 `abd_items_raw.abd_number` 와의 **정확 일치**다.
 * 여기의 정규화 키는 (1) 후보 제안, (2) 표기 차이(공백·대소문자·유니코드 대시)로
 * 인한 미해소를 사람에게 설명하기 위한 보조 키로만 쓴다.
 * 정규화 키가 같다는 이유로 값을 자동 치환하지 않는다 — 사용자 확인이 필요하다.
 */
const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;

export function normalizeAbdNumber(v: unknown): string {
  return String(v ?? "")
    .replace(DASH_VARIANTS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** OCS 번호도 동일 규칙을 쓴다 (별도 규칙을 만들지 않는다). */
export const normalizeOcsNumber = normalizeAbdNumber;
