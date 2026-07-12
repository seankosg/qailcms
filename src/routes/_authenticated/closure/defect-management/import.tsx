import { createFileRoute } from "@tanstack/react-router";
import { DefectManagementImportPage } from "@/components/defect-management/import/DefectManagementImportPage";

export const Route = createFileRoute("/_authenticated/closure/defect-management/import")({
  head: () => ({ meta: [{ title: "Defect Management — Import" }] }),
  component: DefectManagementImportPage,
});