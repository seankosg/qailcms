import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/task-management/import/logs")({
  beforeLoad: () => {
    throw redirect({ to: "/import-log/logs", search: { tab: "task" } });
  },
});