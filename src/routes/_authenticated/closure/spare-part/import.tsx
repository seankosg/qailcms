import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import")({
  beforeLoad: () => {
    throw redirect({ to: "/import-log/import", search: { tab: "spare-part" } });
  },
});
