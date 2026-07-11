import { createFileRoute } from "@tanstack/react-router";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";

export const Route = createFileRoute("/_authenticated/closure/task-management/import/logs")({
  head: () => ({ meta: [{ title: "Task Management — Import Logs" }] }),
  component: () => <ImportLogsPage kind="task_management" />,
});