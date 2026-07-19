export type Origin = "hdec" | "aconex" | "system" | "derived";

export interface OriginHeaderStyle {
  bg: string;
  stickyBg: string;
  border: string;
  label: string;
}

export const ORIGIN_HEADER_STYLES: Record<Origin, OriginHeaderStyle> = {
  hdec: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    stickyBg: "hsl(214 95% 96%)",
    border: "border-b-blue-300 dark:border-b-blue-800",
    label: "HDEC",
  },
  aconex: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    stickyBg: "hsl(150 80% 96%)",
    border: "border-b-emerald-300 dark:border-b-emerald-800",
    label: "Aconex",
  },
  system: {
    bg: "",
    // 프로젝트 컬러 토큰은 oklch(...) 리터럴이라 hsl(var(--background)) 는 무효값이 되어
    // 배경이 painting 되지 않는다. 토큰을 그대로 사용해 완전 불투명 배경을 보장한다.
    stickyBg: "var(--background)",
    border: "",
    label: "System",
  },
};

export function getOriginHeaderStyle(origin: Origin | string | null | undefined): OriginHeaderStyle {
  const key = (origin ?? "system") as Origin;
  return ORIGIN_HEADER_STYLES[key] ?? ORIGIN_HEADER_STYLES.system;
}