/**
 * SPL 단계 상태 어휘 — 정본은 DB `spl_stage_state`.
 * 화면은 여기서 라벨·색 클래스만 정의하고, 상태 판정은 절대 하지 않는다.
 */
export const SPL_STAGE_STATES = ["done", "wip", "delayed", "planned", "none", "na"] as const;
export type SplStageState = (typeof SPL_STAGE_STATES)[number];

export const SPL_STATE_LABEL: Record<SplStageState, string> = {
  done: "완료",
  wip: "진행",
  delayed: "지연",
  planned: "착수전",
  none: "자료없음",
  na: "해당없음",
};

/** 숫자 색 — src/styles.css 토큰만 사용 */
export const SPL_STATE_TEXT: Record<SplStageState, string> = {
  done: "text-[color:var(--success)]",
  wip: "text-[color:var(--info)]",
  delayed: "text-[color:var(--destructive)]",
  planned: "text-muted-foreground",
  none: "text-muted-foreground/60",
  na: "text-muted-foreground/70",
};

/** 칸 배경 */
export const SPL_STATE_CELL: Record<SplStageState, string> = {
  done: "",
  wip: "",
  delayed: "bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)]",
  planned: "",
  none: "bg-muted",
  na: "",
};

/** na 는 45° 빗금 — 채운 색으로 보이면 안 된다 */
export const SPL_NA_HATCH =
  "repeating-linear-gradient(45deg, var(--border) 0 3px, var(--muted) 3px 6px)";

/** 스택바 조각의 배경 (na 는 빗금) */
export function splStateBarStyle(state: SplStageState): React.CSSProperties {
  if (state === "na") return { backgroundImage: SPL_NA_HATCH };
  const map: Record<Exclude<SplStageState, "na">, string> = {
    done: "var(--success)",
    wip: "var(--info)",
    delayed: "var(--destructive)",
    planned: "var(--muted-foreground)",
    none: "var(--muted)",
  };
  return { background: map[state] };
}
