import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SnagProgressPage } from "@/components/defect-management/progress/SnagProgressPage";

const searchSchema = z.object({
  plot: fallback(z.enum(["C", "D"]), "C").default("C"),
  teams: fallback(z.string(), "").default(""),
  roomGroups: fallback(z.string(), "").default(""),
  bucket: fallback(z.enum(["day", "week"]), "day").default("day"),
  stageView: fallback(z.string(), "start,rectified,closure").default("start,rectified,closure"),
  groupBy: fallback(z.string(), "team").default("team"),
  range: fallback(z.number().int(), 60).default(60),
  hidePast: fallback(z.union([z.literal(0), z.literal(1)]), 0).default(0),
  asofMode: fallback(z.enum(["dataDate", "today"]), "dataDate").default("dataDate"),
  planMode: fallback(z.enum(["baseline", "remaining"]), "baseline").default("baseline"),
  matrixOpen: fallback(z.union([z.literal(0), z.literal(1)]), 1).default(1),
  scurveOpen: fallback(z.union([z.literal(0), z.literal(1)]), 1).default(1),
  dataDate: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/snag-management/progress")({
  head: () => ({
    meta: [
      { title: "Snag Progress — QAIL CMS" },
      { name: "description", content: "Snag list 미종결 항목의 스테이지별 Plan vs Actual 진척 매트릭스." },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: SnagProgressPage,
});