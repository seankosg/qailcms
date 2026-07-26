import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AbdProgressPage } from "@/components/abd/progress/AbdProgressPage";

const searchSchema = z.object({
  plot: fallback(z.enum(["all", "C", "D"]), "all").default("all"),
  teams: fallback(z.string(), "").default(""),
  bucket: fallback(z.enum(["day", "week"]), "day").default("day"),
  stageView: fallback(z.string(), "draft_start,draft_finish,submission,dar").default("draft_start,draft_finish,submission,dar"),
  groupBy: fallback(z.string(), "team").default("team"),
  range: fallback(z.number().int(), 60).default(60),
  hidePast: fallback(z.union([z.literal(0), z.literal(1)]), 0).default(0),
  asofMode: fallback(z.enum(["dataDate", "today"]), "today").default("today"),
  dataDate: fallback(z.string(), "").default(""),
  planMode: fallback(z.enum(["baseline", "remaining"]), "baseline").default("baseline"),
  matrixOpen: fallback(z.union([z.literal(0), z.literal(1)]), 1).default(1),
  scurveOpen: fallback(z.union([z.literal(0), z.literal(1)]), 1).default(1),
});

export const Route = createFileRoute("/_authenticated/closure/abd/progress")({
  head: () => ({
    meta: [
      { title: "ABD Progress — QAIL CMS" },
      { name: "description", content: "As-Built Drawing의 라운드별 Draft/Submission/DAR 진척 매트릭스." },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: AbdProgressPage,
});
