import { createFileRoute } from "@tanstack/react-router";
import { DefectManagementImportPage } from "@/components/defect-management/import/DefectManagementImportPage";

export const Route = createFileRoute("/_authenticated/closure/snag-management/import/")({
  head: () => ({ meta: [{ title: "Snag List — Import" }] }),
  component: DefectManagementImportPage,
});