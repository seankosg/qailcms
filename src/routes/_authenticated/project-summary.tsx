import { createFileRoute } from "@tanstack/react-router";
import { ProjectSummaryPage } from "@/components/dashboards/ProjectSummaryPage";

export const Route = createFileRoute("/_authenticated/project-summary")({
  head: () => ({
    meta: [
      { title: "Project Dashboard — QAIL CMS" },
      { name: "description", content: "TM · SM · ABD 진행 현황을 Plot 별로 비교하는 프로젝트 요약 대시보드." },
      { property: "og:title", content: "Project Dashboard — QAIL CMS" },
      { property: "og:description", content: "TM · SM · ABD 진행 현황을 Plot 별로 비교하는 프로젝트 요약 대시보드." },
    ],
  }),
  component: ProjectSummaryPage,
});