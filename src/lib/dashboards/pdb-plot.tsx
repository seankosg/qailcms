import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** PDB 상단 Plot 탭 — "all" 이면 D·C 두 열, 그 외에는 해당 플롯 한 열만 */
export type PdbPlotFilter = "all" | "C" | "D";

type Ctx = { plotFilter: PdbPlotFilter; setPlotFilter: (v: PdbPlotFilter) => void };

const PdbPlotContext = createContext<Ctx>({ plotFilter: "all", setPlotFilter: () => {} });

export function PdbPlotProvider({ children }: { children: ReactNode }) {
  const [plotFilter, setPlotFilter] = useState<PdbPlotFilter>("all");
  const value = useMemo(() => ({ plotFilter, setPlotFilter }), [plotFilter]);
  return <PdbPlotContext.Provider value={value}>{children}</PdbPlotContext.Provider>;
}

export function usePdbPlot() {
  return useContext(PdbPlotContext);
}

/** 선택된 플롯만 남긴다 — 순서(D → C)는 유지 */
export function filterByPlot<T extends { plot?: "C" | "D" }>(
  items: readonly T[],
  plotFilter: PdbPlotFilter,
): T[] {
  return plotFilter === "all" ? [...items] : items.filter((i) => i.plot === plotFilter);
}

/** 한 열만 보일 때 좌우 여백이 생기지 않도록 2열 격자를 끈다 */
export function plotGridClass(plotFilter: PdbPlotFilter) {
  return plotFilter === "all" ? "grid gap-3 xl:grid-cols-2" : "grid gap-3 grid-cols-1";
}
