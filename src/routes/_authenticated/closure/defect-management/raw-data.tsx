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
});

export const Route = createFileRoute("/_authenticated/closure/defect-management/raw-data")({
  head: () => ({ meta: [{ title: "Defect Management — Raw Data" }] }),
  validateSearch: zodValidator(rawDataSearchSchema),
  component: DefectRawDataPage,
});