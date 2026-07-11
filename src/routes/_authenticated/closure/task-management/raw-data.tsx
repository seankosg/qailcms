import { createFileRoute } from "@tanstack/react-router";
import { TaskManagementRawDataPage } from "@/components/task-management/raw-data/TaskManagementRawDataPage";

export const Route = createFileRoute("/_authenticated/closure/task-management/raw-data")({
  head: () => ({ meta: [{ title: "Task Management — Task-Raw Data" }] }),
  component: TaskManagementRawDataPage,
});