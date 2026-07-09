import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/raw-data")({
  head: () => ({ meta: [{ title: "Spare Part — Raw Data" }] }),
  component: RawDataPage,
});

function RawDataPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Spare Part — Raw Data</h1>
      <p className="text-sm text-muted-foreground">Raw data 테이블은 다음 단계에서 SHAW parity로 구축됩니다.</p>
    </div>
  );
}