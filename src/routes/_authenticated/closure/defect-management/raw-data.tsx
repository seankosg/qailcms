import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { DefectRawDataPage } from "@/components/defect-management/raw-data/DefectRawDataPage";

// URL 상태: 탭 / 페이지 / 정렬 / 검색 / 필터 / 비활성 포함
const rawDataSearchSchema = z.object({
  tab: fallback(z.string(), "unclosed").default("unclosed"),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 100).default(100),
  sort: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  filters: fallback(z.string(), "").default(""),
  includeInactive: fallback(z.boolean(), false).default(false),
  source: fallback(z.string(), "").default(""),
  actualComplete: fallback(z.string(), "").default(""),
  closureComplete: fallback(z.string(), "").default(""),
  overdue: fallback(z.string(), "").default(""),
  atRisk: fallback(z.string(), "").default(""),
  atRiskDays: fallback(z.string(), "").default(""),
  dueOn: fallback(z.string(), "").default(""),
  unplannedActualOn: fallback(z.string(), "").default(""),
  asOf: fallback(z.string(), "").default(""),
  stage: fallback(z.string(), "").default(""),
  remaining_stage: fallback(z.string(), "").default(""),
  remaining_asof: fallback(z.string(), "").default(""),
  team: fallback(z.string(), "").default(""),
  subcontractor: fallback(z.string(), "").default(""),
  subsub: fallback(z.string(), "").default(""),
  hdecPic: fallback(z.string(), "").default(""),
  hdecEng: fallback(z.string(), "").default(""),
  capturedBy: fallback(z.string(), "").default(""),
  capturedByGroup: fallback(z.string(), "").default(""),
  level: fallback(z.string(), "").default(""),
  mainTrade: fallback(z.string(), "").default(""),
  subTrade: fallback(z.string(), "").default(""),
  workType: fallback(z.string(), "").default(""),
  classificationSource: fallback(z.string(), "").default(""),
  status: fallback(z.string(), "").default(""),
  closureStatus: fallback(z.string(), "").default(""),
  issueNo: fallback(z.string(), "").default(""),
  subcontractorIssueNo: fallback(z.string(), "").default(""),
  dateStart: fallback(z.string(), "").default(""),
  dateEnd: fallback(z.string(), "").default(""),
  dateField: fallback(z.string(), "").default(""),
  critical: fallback(z.string(), "").default(""),
  priority: fallback(z.string(), "").default(""),
  hdecVerification: fallback(z.string(), "").default(""),
  hdecReason: fallback(z.string(), "").default(""),
  notClosureDone: fallback(z.string(), "").default(""),
  catADispute: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/defect-management/raw-data")({
  head: () => ({ meta: [{ title: "Defect Management — Raw Data" }] }),
  validateSearch: zodValidator(rawDataSearchSchema),
  component: DefectRawDataPage,
});