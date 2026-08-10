import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { MyTmKpiAnalysisPage } from "@/components/my-work-space/MyTmKpiAnalysisPage";

const searchSchema = z.object({
  dataDate: fallback(z.string(), "").default(""),
  delayFilter: fallback(z.string(), "all").default("all"),
  taskScope: fallback(z.string(), "sub").default("sub"),
  workType: fallback(z.string(), "all").default("all"),
  curveBucket: fallback(z.string(), "week").default("week"),
});

export const Route = createFileRoute("/_authenticated/my-kpi-analysis")({
  head: () => ({
    meta: [
      { title: "My KPI Analysis — QAIL CMS" },
      { name: "description", content: "본인 담당 과업의 진도 KPI 및 계획 대비 실적 S-Curve 분석." },
      { property: "og:title", content: "My KPI Analysis — QAIL CMS" },
      { property: "og:description", content: "본인 담당 과업의 진도 KPI 및 계획 대비 실적 S-Curve 분석." },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: MyTmKpiAnalysisPage,
});
