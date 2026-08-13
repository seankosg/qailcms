import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { SplProgressPage } from "@/components/spl/progress/SplProgressPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  plot: z.enum(["all", "C", "D"]).optional().default("all"),
  team: z.string().optional().default("all"),
  stage: z.string().optional().default(""),
  stageState: z.enum(["na", "done", "wip", "delayed", "planned", "none"]).optional(),
});

export const Route = createFileRoute("/_authenticated/closure/spare-part/progress")({
  validateSearch: zodValidator(searchSchema),
  component: SplProgressPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">데이터를 찾을 수 없습니다.</div>,
  head: () => ({
    meta: [
      { title: "Spare Part List Progress | QAIL CMS" },
      { name: "description", content: "예비품 목록(SPL) 22단계 레인 흐름도 — 단계별 완료·진행·지연 집계와 As-of 기준 드릴다운." },
      { property: "og:title", content: "Spare Part List Progress | QAIL CMS" },
      { property: "og:description", content: "SPL 단계별 집계 레인 흐름도와 드릴다운." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
