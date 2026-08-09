import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TmKpiAnalysisPage } from "@/components/task-management/dashboard/TmKpiAnalysisPage";

const searchSchema = z.object({
  discipline: fallback(z.array(z.string()), []).default([]),
  plot: fallback(z.array(z.string()), []).default([]),
  team: fallback(z.array(z.string()), []).default([]),
  dataDate: fallback(z.string(), "").default(""),
  delayFilter: fallback(z.string(), "all").default("all"),
  taskScope: fallback(z.string(), "sub").default("sub"),
  curveKey: fallback(z.string(), "").default(""),
  curveBucket: fallback(z.string(), "week").default("week"),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/task-management/kpi-analysis")({
  head: () => ({
    meta: [
      { title: "Task Management — KPI Analysis" },
      { name: "description", content: "Team and individual progress KPI analysis for task management." },
      { property: "og:title", content: "Task Management — KPI Analysis" },
      { property: "og:description", content: "Team and individual progress KPI analysis for task management." },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: TmKpiAnalysisPage,
});
