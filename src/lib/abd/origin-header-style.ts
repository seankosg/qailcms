// ABD 헤더 색상: 라운드/식별/최신/시스템
export type AbdOrigin = "identity" | "r1" | "r2" | "r3" | "latest" | "system";

export interface OriginHeaderStyle {
  bg: string;
  stickyBg: string;
  border: string;
  label: string;
}

export const ORIGIN_HEADER_STYLES: Record<AbdOrigin, OriginHeaderStyle> = {
  identity: {
    bg: "bg-slate-50 dark:bg-slate-950/40",
    stickyBg: "hsl(210 20% 97%)",
    border: "border-b-slate-300 dark:border-b-slate-800",
    label: "Identity",
  },
  latest: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    stickyBg: "hsl(150 60% 95%)",
    border: "border-b-emerald-300 dark:border-b-emerald-800",
    label: "Latest",
  },
  r1: {
    bg: "bg-sky-50 dark:bg-sky-950/40",
    stickyBg: "hsl(210 90% 96%)",
    border: "border-b-sky-300 dark:border-b-sky-800",
    label: "Round 1",
  },
  r2: {
    bg: "bg-cyan-50 dark:bg-cyan-950/40",
    stickyBg: "hsl(190 80% 95%)",
    border: "border-b-cyan-300 dark:border-b-cyan-800",
    label: "Round 2",
  },
  r3: {
    bg: "bg-violet-50 dark:bg-violet-950/40",
    stickyBg: "hsl(270 70% 96%)",
    border: "border-b-violet-300 dark:border-b-violet-800",
    label: "Round 3",
  },
  system: {
    bg: "",
    stickyBg: "hsl(var(--background))",
    border: "",
    label: "System",
  },
};

export function getOriginHeaderStyle(origin: AbdOrigin | string | null | undefined): OriginHeaderStyle {
  const key = (origin ?? "system") as AbdOrigin;
  return ORIGIN_HEADER_STYLES[key] ?? ORIGIN_HEADER_STYLES.system;
}