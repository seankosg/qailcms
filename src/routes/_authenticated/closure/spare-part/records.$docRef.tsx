import { createFileRoute } from "@tanstack/react-router";
import { SparePartDetailPage } from "@/components/spare-part/detail/SparePartDetailPage";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/records/$docRef")({
  beforeLoad: () => assertAdminOrRedirect(),
  head: ({ params }) => ({ meta: [{ title: `Spare Part — ${params.docRef}` }] }),
  component: SparePartDetailRoute,
});

function SparePartDetailRoute() {
  const { docRef } = Route.useParams();
  return <SparePartDetailPage docRef={docRef} />;
}