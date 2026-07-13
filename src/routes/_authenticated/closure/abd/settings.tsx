import { createFileRoute } from "@tanstack/react-router";
import { AbdSettingsPage } from "@/components/abd/settings/AbdSettingsPage";

export const Route = createFileRoute("/_authenticated/closure/abd/settings")({
  head: () => ({ meta: [{ title: "ABD Settings — QAIL CMS" }] }),
  component: AbdSettingsPage,
});