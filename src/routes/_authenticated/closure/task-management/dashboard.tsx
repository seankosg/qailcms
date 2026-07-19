import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { TmDashboardPage } from "@/components/task-management/dashboard/TmDashboardPage";

const searchSchema = z.object({
  discipline: fallback(z.array(z.string()), []).default([]),
  plot: fallback(z.array(z.string()), []).default([]),
  team: fallback(z.array(z.string()), []).default([]),
  hdecPic: fallback(z.array(z.string()), []).default([]),
  hdecEng: fallback(z.array(z.string()), []).default([]),
  ownerDim: fallback(z.string(), "hdec_pic_name").default("hdec_pic_name"),
  asofMode: fallback(z.string(), "dataDate").default("dataDate"),
  delayFilter: fallback(z.string(), "all").default("all"),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/task-management/dashboard")({
  head: () => ({
    meta: [{ title: "Task Management — Delay Dashboard" }],
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
  component: TmDashboardPage,
});