import { createFileRoute } from "@tanstack/react-router";
import { DefectCategoryTeamMapPage } from "@/components/defect-management/settings/DefectCategoryTeamMapPage";

export const Route = createFileRoute("/_authenticated/closure/snag-management/settings")({
  head: () => ({ meta: [{ title: "Snag List Settings — QAIL CMS" }] }),
  component: DefectCategoryTeamMapPage,
});