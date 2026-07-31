import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadLastRoute } from "@/lib/last-route";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const last = loadLastRoute();
      if (last) {
        navigate({ href: last, replace: true });
        return;
      }
      navigate({ to: "/my-work-space", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}