import { createFileRoute } from "@tanstack/react-router";
import { SparePartDetailPage } from "@/components/spare-part/detail/SparePartDetailPage";

export const Route = createFileRoute("/_authenticated/closure/spare-part/records/$docRef")({
  head: ({ params }) => ({ meta: [{ title: `Spare Part — ${params.docRef}` }] }),
  component: SparePartDetailRoute,
});

function SparePartDetailRoute() {
  const { docRef } = Route.useParams();
  return <SparePartDetailPage docRef={docRef} />;
}