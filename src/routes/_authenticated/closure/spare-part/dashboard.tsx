import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { SplDashboardPage } from "@/components/spl/dashboard/SplDashboardPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  plot: z.string().optional().default("all"),
  team: z.string().optional().default("all"),
  /** 계열 단위: band | stage */
  stageMode: z.string().optional().default("band"),
  /** 선택 단계(csv). 비면 전체 */
  stages: z.string().optional().default(""),
  bucket: z.string().optional().default("week"),
  range: z.number().optional().default(120),
  planMode: z.string().optional().default("baseline"),
  scurveOpen: z.number().optional().default(1),
});

export const Route = createFileRoute("/_authenticated/closure/spare-part/dashboard")({
  validateSearch: zodValidator(searchSchema),
  component: SplDashboardPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Spare Part List Dashboard | QAIL CMS" },
      {
        name: "description",
        content: "예비품 목록(SPL) 판정 KPI와 밴드별 지연 분포를 As-of 기준으로 보여주는 대시보드.",
      },
      { property: "og:title", content: "Spare Part List Dashboard | QAIL CMS" },
      { property: "og:description", content: "SPL 판정 KPI·지연 밴드 분포 대시보드." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});