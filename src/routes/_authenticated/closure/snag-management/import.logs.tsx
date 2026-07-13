import { createFileRoute } from "@tanstack/react-router";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";

export const Route = createFileRoute("/_authenticated/closure/defect-management/import/logs")({
  head: () => ({ meta: [{ title: "Defect Management — Import Logs" }] }),
  component: () => <ImportLogsPage kind="defect_management" />,
});