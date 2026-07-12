import { createFileRoute } from "@tanstack/react-router";

function DefectDashboardPlaceholder() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Defect Management — Dashboard</h1>
      <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
        Phase 3에서 구현됩니다. KPI + S-Curve + Breakdown 대시보드.
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/closure/defect-management/dashboard")({
  head: () => ({ meta: [{ title: "Defect Management — Dashboard" }] }),
  component: DefectDashboardPlaceholder,
});