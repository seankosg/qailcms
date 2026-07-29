import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { AbdDetailPage } from "@/components/abd/detail/AbdDetailPage";

const searchSchema = z.object({
  focus: fallback(z.enum(["rounds", "aconex", "comments"]).optional(), undefined).default(undefined),
});

export const Route = createFileRoute("/_authenticated/closure/abd/detail/$id")({
  head: () => ({ meta: [{ title: "ABD Detail — QAIL CMS" }] }),
  validateSearch: zodValidator(searchSchema),
  component: AbdDetailPage,
});