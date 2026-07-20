import { createFileRoute } from "@tanstack/react-router";
import { SparePartRawDataPage } from "@/components/spare-part/raw-data/SparePartRawDataPage";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/raw-data")({
  beforeLoad: () => assertAdminOrRedirect(),
  head: () => ({ meta: [{ title: "Spare Part — SPT-Raw Data" }] }),
  component: SparePartRawDataPage,
});