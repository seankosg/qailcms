import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AbdRawDataPage } from "@/components/abd/raw-data/AbdRawDataPage";

const abdRawDataSearchSchema = z.object({
  tab: fallback(z.string(), "MECH").default("MECH"),
  status: fallback(z.string(), "all").default("all"),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 100).default(100),
  sort: fallback(z.string(), "").default(""),
  q: fallback(z.string(), "").default(""),
  filters: fallback(z.string(), "").default(""),
  includeInactive: fallback(z.boolean(), false).default(false),
  detail: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/closure/abd/raw-data")({
  head: () => ({ meta: [{ title: "ABD Raw Data — QAIL CMS" }] }),
  validateSearch: zodValidator(abdRawDataSearchSchema),
  component: AbdRawDataPage,
});