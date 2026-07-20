import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TaskTreePage } from "@/components/task-management/tree/TaskTreePage";

const searchSchema = z.object({
  dataDate: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/task-management/tree")({
  head: () => ({ meta: [{ title: "Task Tree" }] }),
  validateSearch: zodValidator(searchSchema),
  component: TaskTreePage,
});