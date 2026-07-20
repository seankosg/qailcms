import { createFileRoute } from "@tanstack/react-router";
import { TaskScheduleRevisionPage } from "@/components/task-management/schedule-revision/TaskScheduleRevisionPage";

export const Route = createFileRoute("/_authenticated/closure/task-management/schedule-revision")({
  head: () => ({ meta: [{ title: "Task Management — Schedule Revision" }] }),
  component: TaskScheduleRevisionPage,
});