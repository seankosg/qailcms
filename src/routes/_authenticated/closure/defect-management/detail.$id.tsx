import { createFileRoute } from "@tanstack/react-router";
import { DefectDetailPage } from "@/components/defect-management/detail/DefectDetailPage";

export const Route = createFileRoute("/_authenticated/closure/defect-management/detail/$id")({
  head: () => ({ meta: [{ title: "Defect Detail" }] }),
  component: DefectDetailPage,
});