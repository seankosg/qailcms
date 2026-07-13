import { createFileRoute } from "@tanstack/react-router";
import { OutstandingDashboardPage } from "@/components/dashboards/OutstandingDashboardPage";

export const Route = createFileRoute("/_authenticated/outstanding/dashboard")({
  head: () => ({
    meta: [
      { title: "Outstanding Work — QAIL CMS" },
      { name: "description", content: "미완료 업무(Task, Snag) 요약 대시보드." },
    ],
  }),
  component: OutstandingDashboardPage,
});