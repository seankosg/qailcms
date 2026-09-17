/**
 * TOC 코드형 단계의 값 사전.
 *
 * 규칙(프로젝트 규칙 "추측 금지"):
 *  - `CLOSED_VOCAB` 에 등록된 단계는 사전에 없는 값이 오면 **저장을 거부**하고 값·건수·예시를 보고한다.
 *  - 자유 서술이 실재하는 단계(자산태그 목록/설치, 서비스리포트)는 사전을 강제하지 않는다.
 *    (원천에 "Thermographic scanning on-going …" 같은 문장이 그대로 들어와 있다 — 2026-09 실측)
 *  - 대소문자만 다른 값은 사전 표기로 정규화하고, 사전이 없는 단계는 원문을 그대로 보존한다.
 */
export const TOC_CLOSED_VOCAB: Record<string, string[]> = {
  TAC_COMPLETION: ["Completed", "In Progress", "Not Started"],
  OMM_APPROVAL: ["Approved", "UR DAR", "UR IFM", "Code B", "Code C", "Not Submitted"],
  AT_APPROVAL: ["Approved", "Code A", "Code B", "Code C", "UR DAR", "Not Submitted"],
  ABD_CODE_A: ["Completed", "Code A", "Code B", "Code C", "UR DAR", "Not Submitted"],
  TOC_RESPONSE: ["Code A", "Code C", "UR IFM", "Not Submitted"],
};

export interface CodeValueResult {
  value: string | null;
  /** 사전에 없는 값 — 저장하지 않고 보고한다 */
  invalid?: string;
}

/** 코드 셀 값 정규화. 사전이 있는 단계에서 미등록 값이면 invalid 로 돌려준다. */
export function normalizeTocCode(stageCode: string, raw: unknown): CodeValueResult {
  if (raw == null) return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  const vocab = TOC_CLOSED_VOCAB[stageCode];
  if (!vocab) return { value: s };
  const hit = vocab.find((v) => v.toLowerCase() === s.toLowerCase());
  if (hit) return { value: hit };
  return { value: null, invalid: s };
}
