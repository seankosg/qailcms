import { createFileRoute } from "@tanstack/react-router";
import { TaskTreePage } from "@/components/task-management/tree/TaskTreePage";

export const Route = createFileRoute("/_authenticated/closure/task-management/tree")({
  head: () => ({ meta: [{ title: "Task Tree" }] }),
  component: TaskTreePage,
});