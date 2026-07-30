import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AbdRawDataPage } from "@/components/abd/raw-data/AbdRawDataPage";

const abdRawDataSearchSchema = z.object({
  tab: fallback(z.string(), "MECH").default("MECH"),
  plot: fallback(z.enum(["all", "C", "D"]), "all").default("all"),
  status: fallback(z.string(), "all").default("all"),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.union([z.number().int(), z.literal("all")]), 100).default(100),
  sort: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  filters: fallback(z.string(), "").default(""),
  includeInactive: fallback(z.boolean(), false).default(false),
  detail: fallback(z.string(), "").default(""),
  // Progress 페이지에서 전달하는 셀 클릭 컨텍스트
  source: fallback(z.string(), "").default(""),
  team: fallback(z.string(), "").default(""),
  dis: fallback(z.string(), "").default(""),
  service: fallback(z.string(), "").default(""),
  pic: fallback(z.string(), "").default(""),
  docAx: fallback(z.string(), "").default(""),
  docAxx: fallback(z.string(), "").default(""),
  batch: fallback(z.string(), "").default(""),
  dateStart: fallback(z.string(), "").default(""),
  dateEnd: fallback(z.string(), "").default(""),
  dateField: fallback(z.string(), "").default(""),
  dateFields: fallback(z.string(), "").default(""),
  stage: fallback(z.string(), "").default(""),
  // Progress Matrix 셀 드릴다운 전용(술어 정본 = abd_progress_events)
  cellStage: fallback(z.string(), "").default(""),
  cellField: fallback(z.string(), "").default(""),
  cellFrom: fallback(z.string(), "").default(""),
  cellTo: fallback(z.string(), "").default(""),
  cellMode: fallback(z.string(), "").default(""),
  // 매트릭스가 보던 As-of 를 명시 전달(세션 공유에 의존하지 않음)
  asOf: fallback(z.string(), "").default(""),
  round: fallback(z.enum(["R1", "R2", "R3", "all"]), "all").default("all"),
  // 모집단 정본: Terminated 포함 전수(6,659). Progress·Dashboard 와 동일 기준.
  excluded: fallback(z.enum(["hide", "only", "all"]), "all").default("all"),
});

export const Route = createFileRoute("/_authenticated/closure/abd/raw-data")({
  head: () => ({ meta: [{ title: "ABD Raw Data — QAIL CMS" }] }),
  validateSearch: zodValidator(abdRawDataSearchSchema),
  component: AbdRawDataPage,
});