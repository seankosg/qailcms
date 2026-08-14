/**
 * SPL Required Document(flag) 값 정본 사전 — **이 파일이 유일본**이다.
 * 파서·화면·서버 어디에도 사전을 복사하지 않는다.
 *
 * 2026-08-14 사용자 판정 확정. 사전에 없는 값은 추측하지 않고 UNKNOWN 으로 두어
 * 임포트 저장 단계에서 거부한다(모르면 막는다).
 */

export const SPL_FLAG_REQUIRED = "REQUIRED" as const;
export const SPL_FLAG_NA = "N/A" as const;
/** 사전에 없는 값 */
export const SPL_FLAG_UNKNOWN = "UNKNOWN" as const;

export type SplFlagValue = typeof SPL_FLAG_REQUIRED | typeof SPL_FLAG_NA;
export type SplFlagNormalized = SplFlagValue | null | typeof SPL_FLAG_UNKNOWN;

/** 키는 대소문자·앞뒤 공백 무시로 비교한다 (upper(btrim(...))) */
const DICTIONARY: Record<string, SplFlagValue> = {
  REQUIRED: SPL_FLAG_REQUIRED,
  O: SPL_FLAG_REQUIRED,
  YES: SPL_FLAG_REQUIRED,
  "NOT YET": SPL_FLAG_REQUIRED,
  "SPL ARE INCOMPLETE AS PER SPECS": SPL_FLAG_REQUIRED,
  "MFG. LETTER FOR PHYSICAL": SPL_FLAG_REQUIRED,
  "RQRD-NOT FINAL": SPL_FLAG_REQUIRED,
  "SPECIALIST LETTER FOR PHYSICAL": SPL_FLAG_REQUIRED,
  "N/A": SPL_FLAG_NA,
  X: SPL_FLAG_NA,
  "0": SPL_FLAG_NA,
};

/** 빈 칸 = null (오류 아님) / 사전에 없으면 UNKNOWN */
export function normalizeSplFlagValue(raw: unknown): SplFlagNormalized {
  if (raw == null) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return DICTIONARY[t.toUpperCase()] ?? SPL_FLAG_UNKNOWN;
}
