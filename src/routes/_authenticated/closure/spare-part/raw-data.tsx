import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { SplRawDataPage } from "@/components/spl/raw-data/SplRawDataPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  q: z.string().optional().default(""),
  plot: z.enum(["all", "C", "D"]).optional().default("all"),
  judgment: z.enum(["all", "완료", "정상", "지연", "미분류", "제외"]).optional().default("all"),
  /** 밴드별 대표 지연 셀 드릴다운 — 활성 밴드이면서 대표 지연이 그 밴드에 속한 행만 */
  delayBand: z.string().optional().default(""),
});

export const Route = createFileRoute("/_authenticated/closure/spare-part/raw-data")({
  validateSearch: zodValidator(searchSchema),
  component: SplRawDataPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">데이터를 찾을 수 없습니다.</div>,
  head: () => ({
    meta: [
      { title: "Spare Part List Raw Data | QAIL CMS" },
      { name: "description", content: "예비품 목록(SPL) 22단계 진행 현황 원본 데이터 — As-of 기준 정본 판정 및 왕복 임포트 양식 내보내기." },
      { property: "og:title", content: "Spare Part List Raw Data | QAIL CMS" },
      { property: "og:description", content: "예비품 목록(SPL) 22단계 진행 현황 원본 데이터와 As-of 기준 판정." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});