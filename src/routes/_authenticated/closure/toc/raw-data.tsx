import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { TocRawDataPage } from "@/components/toc/raw-data/TocRawDataPage";

const searchSchema = z.object({
  asOf: z.string().optional().default(""),
  tab: z.string().optional().default("in_progress"),
  q: z.string().optional().default(""),
  sort: z.string().optional().default(""),
  filters: z.string().optional().default(""),
  page: z.number().optional().default(1),
  pageSize: z.union([z.number(), z.literal("all")]).optional().default(100),
});

export const Route = createFileRoute("/_authenticated/closure/toc/raw-data")({
  validateSearch: zodValidator(searchSchema),
  component: TocRawDataPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Handover (TOC) Raw Data | QAIL CMS" },
      {
        name: "description",
        content: "IFM 인계(TOC) 준비 밴드 7종과 항목별 판정을 As-of 기준으로 보여주는 원자료 화면.",
      },
      { property: "og:title", content: "Handover (TOC) Raw Data | QAIL CMS" },
      { property: "og:description", content: "TOC 준비 밴드·판정 원자료 화면." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
