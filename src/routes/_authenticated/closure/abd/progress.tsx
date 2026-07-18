import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AbdProgressPage } from "@/components/abd/progress/AbdProgressPage";

const searchSchema = z.object({
  plot: fallback(z.enum(["all", "C", "D"]), "all").default("all"),
  teams: fallback(z.string(), "").default(""),
  round: fallback(z.enum(["R1", "R2", "R3", "all"]), "all").default("all"),
  bucket: fallback(z.enum(["day", "week"]), "day").default("day"),
  stageView: fallback(z.string(), "draft,submission,dar").default("draft,submission,dar"),
  groupBy: fallback(z.string(), "team").default("team"),
  range: fallback(z.number().int(), 60).default(60),
  hidePast: fallback(z.union([z.literal(0), z.literal(1)]), 0).default(0),
  asofMode: fallback(z.enum(["dataDate", "today"]), "today").default("today"),
  planMode: fallback(z.enum(["baseline", "remaining"]), "baseline").default("baseline"),
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
