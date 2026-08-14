/**
 * 지시–이행 루프 어휘 — 정본 판정은 DB `thread_rows_as_of` 가 내려준다.
 * 여기서는 라벨과 색 클래스만 정의한다. 상태 판정 금지.
 * (src/lib/spl/stage-state.ts 와 같은 구조)
 */
export const THREAD_STATUSES = ["pending", "yes", "no", "wip"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  pending: "응답 대기",
  yes: "이행",
  no: "미이행",
  wip: "진행중",
};

/** 상태 색 — Progress 화면과 같은 조합. 배지에는 항상 글자를 함께 단다. */
export const THREAD_STATUS_TEXT: Record<ThreadStatus, string> = {
  pending: "text-[color:var(--muted-foreground)]",
  yes: "text-[color:var(--success)]",
  no: "text-[color:var(--destructive)]",
  wip: "text-[color:var(--info)]",
};

export const THREAD_STATUS_BADGE: Record<ThreadStatus, string> = {
  pending: "border-[color:var(--muted-foreground)] text-[color:var(--muted-foreground)]",
  yes: "border-[color:var(--success)] text-[color:var(--success)]",
  no: "border-[color:var(--destructive)] text-[color:var(--destructive)]",
  wip: "border-[color:var(--info)] text-[color:var(--info)]",
};

export const THREAD_KIND_LABEL: Record<string, string> = {
  report: "보고",
  question: "질문",
  instruction: "지시",
  decision: "결정",
  response: "응답",
};

/** 경과일 색 — 상태 색과 다른 축이다. 섞지 마라. */
export function threadAgeClass(days: number | null | undefined): string {
  if (days == null) return "text-muted-foreground";
  if (days >= 14) return "text-[color:var(--destructive)]";
  if (days >= 7) return "text-[color:var(--warning)]";
  return "text-muted-foreground";
}
