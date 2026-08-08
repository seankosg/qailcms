import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/dashboard/")({
  beforeLoad: () => {
    throw redirect({ to: "/project-dashboard" });
  },
});
