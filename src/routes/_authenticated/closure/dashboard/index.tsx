import { createFileRoute } from "@tanstack/react-router";
import { DashboardHubPage } from "@/components/dashboard/DashboardHubPage";

export const Route = createFileRoute("/_authenticated/closure/dashboard/")({
  head: () => ({
    meta: [{ title: "Closure Dashboard — QAIL CMS" }],
  }),
  component: DashboardHubPage,
});