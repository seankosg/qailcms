import { createFileRoute } from "@tanstack/react-router";
import { ProjectDashboardPage } from "@/components/dashboards/ProjectDashboardPage";

export const Route = createFileRoute("/_authenticated/project-dashboard")({
  head: () => ({
    meta: [
      { title: "Project Dashboard — QAIL CMS" },
      { name: "description", content: "프로젝트 전체 마일스톤 및 미완료 업무 요약." },
    ],
  }),
  component: ProjectDashboardPage,
});
