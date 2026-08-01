import { createFileRoute } from "@tanstack/react-router";
import { CloseOutDashboardPage } from "@/components/dashboards/CloseOutDashboardPage";

export const Route = createFileRoute("/_authenticated/closeout/dashboard")({
  head: () => ({
    meta: [
      { title: "Close-Out Doc — QAIL CMS" },
      { name: "description", content: "준공 문서(ABD, Spare Part List, Warranty) 요약 대시보드." },
    ],
  }),
  component: CloseOutDashboardPage,
});