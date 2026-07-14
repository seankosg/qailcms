import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/abd/import")({
  beforeLoad: () => {
    throw redirect({ to: "/import-log/import", search: { tab: "abd" } });
  },
});