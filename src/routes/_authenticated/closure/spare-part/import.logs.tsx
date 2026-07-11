import { createFileRoute } from "@tanstack/react-router";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import/logs")({
  head: () => ({ meta: [{ title: "Spare Part — Import Logs" }] }),
  component: () => <ImportLogsPage kind="spare_part" />,
});