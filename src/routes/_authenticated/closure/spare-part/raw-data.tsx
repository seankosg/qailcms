import { createFileRoute } from "@tanstack/react-router";
import { SparePartRawDataPage } from "@/components/spare-part/raw-data/SparePartRawDataPage";

export const Route = createFileRoute("/_authenticated/closure/spare-part/raw-data")({
  head: () => ({ meta: [{ title: "Spare Part — Raw Data" }] }),
  component: SparePartRawDataPage,
});