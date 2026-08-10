import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { DeSnagDashboardPage } from "@/components/defect-management/dashboard/DeSnagDashboardPage";

const searchSchema = z.object({
  plot: fallback(z.enum(["C", "D"]), "C").default("C"),
  teams: fallback(z.string(), "").default(""),
  roomGroups: fallback(z.string(), "").default(""),
  dataDate: fallback(z.string(), "").default(""),
  matrixMode: fallback(z.string(), "remainPct").default("remainPct"),
  hoDate: fallback(z.union([z.literal(0), z.literal(1)]), 0).default(0),
});

export const Route = createFileRoute("/_authenticated/closure/snag-management/dashboard")({
  head: () => ({
    meta: [
      { title: "Snag Dashboard — QAIL CMS" },
      { name: "description", content: "De-Snagging 매트릭스 대시보드 (Plot · Level × Room Group)." },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: DeSnagDashboardPage,
});
