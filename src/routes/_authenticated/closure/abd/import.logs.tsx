import { createFileRoute } from "@tanstack/react-router";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";

export const Route = createFileRoute("/_authenticated/closure/abd/import/logs")({
  head: () => ({ meta: [{ title: "ABD — Import Logs" }] }),
  component: () => <ImportLogsPage kind="abd" />,
});