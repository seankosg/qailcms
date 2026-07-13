import { createFileRoute } from "@tanstack/react-router";
import { DefectCategoryTeamMapPage } from "@/components/defect-management/settings/DefectCategoryTeamMapPage";

export const Route = createFileRoute("/_authenticated/closure/defect-management/settings")({
  head: () => ({ meta: [{ title: "Defect Settings — QAIL CMS" }] }),
  component: DefectCategoryTeamMapPage,
});