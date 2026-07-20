import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import")({
  beforeLoad: async () => {
    await assertAdminOrRedirect();
    throw redirect({ to: "/import-log/import", search: { tab: "spare-part" } });
  },
});
