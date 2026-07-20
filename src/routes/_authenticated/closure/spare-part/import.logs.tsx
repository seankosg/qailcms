import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import/logs")({
  beforeLoad: async () => {
    await assertAdminOrRedirect();
    throw redirect({ to: "/import-log/logs", search: { tab: "spare-part" } });
  },
});