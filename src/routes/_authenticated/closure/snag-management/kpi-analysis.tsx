import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SnagKpiAnalysisPage } from "@/components/defect-management/kpi/SnagKpiAnalysisPage";

const searchSchema = z.object({
  plot: fallback(z.enum(["C", "D"]), "C").default("C"),
  teams: fallback(z.string(), "").default(""),
  roomGroups: fallback(z.string(), "").default(""),
  bucket: fallback(z.enum(["day", "week"]), "day").default("day"),
  stageView: fallback(z.string(), "closure").default("closure"),
  groupBy: fallback(z.string(), "team").default("team"),
  range: fallback(z.number().int(), 60).default(60),
  planMode: fallback(z.enum(["baseline", "remaining"]), "remaining").default("remaining"),
  unit: fallback(z.enum(["cnt", "pct"]), "cnt").default("cnt"),
  dataDate: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/snag-management/kpi-analysis")({
  head: () => ({
    meta: [
      { title: "Snag KPI Analysis — QAIL CMS" },
      {
        name: "description",
        content: "Snag list 스테이지별 그룹 진척과 Plan vs Actual S-Curve 분석 화면.",
      },
      { property: "og:title", content: "Snag KPI Analysis — QAIL CMS" },
      {
        property: "og:description",
        content: "Snag list 스테이지별 그룹 진척과 Plan vs Actual S-Curve 분석 화면.",
      },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: SnagKpiAnalysisPage,
});