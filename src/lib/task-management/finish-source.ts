/**
 * P3-5 원설계 복원(2026-08-03): 완료일 '미확인' 배지 범위.
 * 'user' 만 사람이 확인한 정본이고, 'import'(엑셀 완료일 열)는 원본이 정본이므로 배지 제외.
 * 그 외(auto | forecast | migration)는 전부 추정값 → 배지 대상.
 */
export const FINISH_SOURCE_CONFIRMED = ["user", "import"] as const;

export function isUnconfirmedFinishSource(source: unknown): boolean {
  const s = typeof source === "string" ? source.trim() : "";
  if (!s) return false;
  return !(FINISH_SOURCE_CONFIRMED as readonly string[]).includes(s);
}

export function finishSourceTooltip(source: unknown): string {
  switch (typeof source === "string" ? source.trim() : "") {
    case "forecast":
      return "완료일 미확인 — '예상 완료' 열에서 들어온 값입니다. 확인해 주세요.";
    case "migration":
      return "완료일 미확인 — 정합 마이그레이션이 이력에서 추정한 값입니다. 확인해 주세요.";
    case "auto":
      return "완료일 미확인 — 진도율 100% 입력 시 자동 기록된 날짜입니다. 확인해 주세요.";
    case "import":
      return "엑셀 완료일 열에서 들어온 값입니다.";
    default:
      return "완료일 미확인 — 출처가 확인되지 않은 값입니다. 확인해 주세요.";
  }
}
