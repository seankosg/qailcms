import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { TocDashboardPage } from "@/components/toc/dashboard/TocDashboardPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  plot: z.string().optional().default("all"),
  team: z.string().optional().default("all"),
  stageMode: z.string().optional().default("band"),
  stages: z.string().optional().default(""),
  bucket: z.string().optional().default("week"),
  range: z.number().optional().default(120),
  planMode: z.string().optional().default("baseline"),
  scurveOpen: z.number().optional().default(1),
});

export const Route = createFileRoute("/_authenticated/closure/toc/dashboard")({
  validateSearch: zodValidator(searchSchema),
  component: TocDashboardPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Handover (TOC) Dashboard | QAIL CMS" },
      {
        name: "description",
        content: "인계(TOC) 준비 밴드 7종의 판정 분포와 계획 대비 실적 곡선을 As-of 기준으로 보여주는 대시보드.",
      },
      { property: "og:title", content: "Handover (TOC) Dashboard | QAIL CMS" },
      { property: "og:description", content: "TOC 판정 분포·밴드 준비도·진도 곡선 대시보드." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
