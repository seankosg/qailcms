import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/snag-management/import/logs")({
  beforeLoad: () => {
    throw redirect({ to: "/import-log/logs", search: { tab: "snag" } });
  },
});