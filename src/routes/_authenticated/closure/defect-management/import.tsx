import { createFileRoute } from "@tanstack/react-router";
import { DefectManagementImportProvider } from "@/contexts/DefectManagementImportContext";
import { DefectManagementImportPage } from "@/components/defect-management/import/DefectManagementImportPage";

function DefectImportRoute() {
  return (
    <DefectManagementImportProvider>
      <DefectManagementImportPage />
    </DefectManagementImportProvider>
  );
}

export const Route = createFileRoute("/_authenticated/closure/defect-management/import")({
  head: () => ({ meta: [{ title: "Defect Management — Import" }] }),
  component: DefectImportRoute,
});