import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TaskDashboardPage } from "@/components/task-management/dashboard/TaskDashboardPage";

const searchSchema = z.object({
  group: fallback(z.array(z.string()), []).default([]),
  discipline: fallback(z.array(z.string()), []).default([]),
  plot: fallback(z.array(z.string()), []).default([]),
  team: fallback(z.array(z.string()), []).default([]),
  bucket: fallback(z.string(), "day").default("day"),
  stageView: fallback(z.array(z.string()), []).default([]),
  asofMode: fallback(z.string(), "today").default("today"),
  planMode: fallback(z.string(), "remaining").default("remaining"),
  range: fallback(z.number().int(), 60).default(60),
  hidePast: fallback(z.boolean(), false).default(false),
  riskPanel: fallback(z.boolean(), true).default(true),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/dashboard/task")({
  head: () => ({
    meta: [{ title: "Task Dashboard — QAIL CMS" }],
  }),
  validateSearch: zodValidator(searchSchema),
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive" role="alert">
      {(error as Error).message ?? "대시보드를 불러오지 못했습니다."}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">페이지를 찾을 수 없습니다.</div>
  ),
  component: () => <TaskDashboardPage />,
});