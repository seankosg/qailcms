import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { TocProgressPage } from "@/components/toc/progress/TocProgressPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  plot: z.string().optional().default("all"),
  team: z.string().optional().default("all"),
  stage: z.string().optional().default(""),
  state: z.string().optional().default(""),
});

export const Route = createFileRoute("/_authenticated/closure/toc/progress")({
  validateSearch: zodValidator(searchSchema),
  component: TocProgressPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Handover (TOC) Progress | QAIL CMS" },
      {
        name: "description",
        content: "인계(TOC) 7개 밴드 레인별 단계 상태와 현재 단계 분포를 As-of 기준으로 보여주는 진행 화면.",
      },
      { property: "og:title", content: "Handover (TOC) Progress | QAIL CMS" },
      { property: "og:description", content: "TOC 밴드 레인·단계 상태·현재 단계 진행 화면." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
