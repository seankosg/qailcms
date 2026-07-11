import { createFileRoute } from "@tanstack/react-router";
import { TaskDashboardCards } from "@/components/task-management/dashboard/TaskDashboardCards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/dashboard")({
  head: () => ({ meta: [{ title: "Closure — Dashboard" }] }),
  component: () => (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Closure — Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Task Management 진행 현황 및 지연 감시.
        </p>
      </div>
      <TaskDashboardCards />
    </div>
  ),
});