import { createFileRoute } from "@tanstack/react-router";
import { TaskDetailPage } from "@/components/task-management/detail/TaskDetailPage";

export const Route = createFileRoute("/_authenticated/closure/task-management/detail/$id")({
  head: () => ({ meta: [{ title: "Task Detail" }] }),
  component: TaskDetailPage,
});