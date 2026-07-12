import { createFileRoute } from "@tanstack/react-router";
import { DefectRawDataPage } from "@/components/defect-management/raw-data/DefectRawDataPage";

export const Route = createFileRoute("/_authenticated/closure/defect-management/raw-data")({
  head: () => ({ meta: [{ title: "Defect Management — Raw Data" }] }),
  component: DefectRawDataPage,
});