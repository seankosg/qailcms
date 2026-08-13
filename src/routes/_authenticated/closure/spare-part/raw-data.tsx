import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { SplRawDataPage } from "@/components/spl/raw-data/SplRawDataPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  q: z.string().optional().default(""),
  plot: z.enum(["all", "C", "D"]).optional().default("all"),
  judgment: z.enum(["all", "완료", "정상", "지연", "미분류", "제외", "미착수"]).optional().default("all"),
  /** HDEC 실적 미확보(HDEC 권한 단계 실적 0건) 드릴다운 */
  hdecMissing: z.boolean().optional().default(false),
  /** OCS 캐시 숫자 기반 필터 (현재 시점 조회에서만 적용) */
  ocs: z.enum(["all", "pending", "complied", "none"]).optional().default("all"),
  /** 밴드별 대표 지연 셀 드릴다운 — 활성 밴드이면서 대표 지연이 그 밴드에 속한 행만 */
  delayBand: z.string().optional().default(""),
  /** Progress 드릴다운 — 단계 코드(catalog.stage_code) */
  stage: z.string().optional().default(""),
  /** Progress 드릴다운 — 그 단계의 상태. stage 와 함께 있을 때만 적용 */
  stageState: z.enum(["na", "done", "wip", "delayed", "planned", "none"]).optional(),
  /** 팀 필터 */
  team: z.string().optional().default("all"),
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