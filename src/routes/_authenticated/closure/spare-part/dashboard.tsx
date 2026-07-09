import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/dashboard")({
  head: () => ({ meta: [{ title: "Spare Part — Dashboard" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Spare Part — Dashboard</h1>
      <p className="text-sm text-muted-foreground">KPI/차트는 다음 단계에서 구축됩니다.</p>
    </div>
  ),
});