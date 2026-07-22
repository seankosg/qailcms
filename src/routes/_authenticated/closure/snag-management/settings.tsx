import { createFileRoute } from "@tanstack/react-router";
import { SnagListSettingsPage } from "@/components/defect-management/settings/SnagListSettingsPage";

export const Route = createFileRoute("/_authenticated/closure/snag-management/settings")({
  head: () => ({ meta: [{ title: "Snag List Settings — QAIL CMS" }] }),
  component: SnagListSettingsPage,
});