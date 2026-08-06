import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TaskManagementRawDataPage } from "@/components/task-management/raw-data/TaskManagementRawDataPage";

const searchSchema = z.object({
  source: fallback(z.string(), "").default(""),
  mode: fallback(z.string(), "").default(""),
  asOf: fallback(z.string(), "").default(""),
  taskScope: fallback(z.string(), "").default(""),
  team: fallback(z.string(), "").default(""),
  hdec_pic_name: fallback(z.string(), "").default(""),
  hdec_eng_name: fallback(z.string(), "").default(""),
  discipline: fallback(z.string(), "").default(""),
  plot: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  dataDate: fallback(z.string(), "").default(""),
  planOverdue: fallback(z.string(), "").default(""),
  actualOverdue: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/task-management/raw-data")({
  head: () => ({ meta: [{ title: "Task Management — Task-Raw Data" }] }),
  validateSearch: zodValidator(searchSchema),
  component: TaskManagementRawDataPage,
});