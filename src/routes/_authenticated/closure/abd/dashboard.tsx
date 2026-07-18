import { createFileRoute } from "@tanstack/react-router";
import { AbdDashboardPage } from "@/components/abd/dashboard/AbdDashboardPage";

export const Route = createFileRoute("/_authenticated/closure/abd/dashboard")({
  head: () => ({
    meta: [
      { title: "ABD Dashboard — QAIL CMS" },
      {
        name: "description",
        content:
          "As-Built Drawing 라운드별 진척, 승인률, 지연/대기 항목을 한눈에 확인하는 대시보드.",
      },
    ],
  }),
  component: AbdDashboardPage,
});