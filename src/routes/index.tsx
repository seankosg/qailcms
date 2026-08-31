import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveLandingRoute } from "@/lib/auth/landing";
import { makeIsKnownPath } from "@/lib/auth/known-path";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const href = await resolveLandingRoute(data.session.user.id, makeIsKnownPath(router));
      if (cancelled) return;
      navigate({ href, replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, router]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}