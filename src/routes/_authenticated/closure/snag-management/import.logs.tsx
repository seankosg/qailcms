import { createFileRoute } from "@tanstack/react-router";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";

export const Route = createFileRoute("/_authenticated/closure/snag-management/import/logs")({
  head: () => ({ meta: [{ title: "Snag List — Import Logs" }] }),
  component: () => <ImportLogsPage kind="defect_management" />,
});