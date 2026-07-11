import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { resolveLoginEmail } from "@/lib/auth/resolveLoginEmail.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — QAIL Closure Document" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const resolve = useServerFn(resolveLoginEmail);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/closure/spare-part/raw-data", replace: true });
    });
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { email } = await resolve({ data: { loginId: loginId.trim() } });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("로그인되었습니다");
      navigate({ to: "/closure/spare-part/raw-data", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "로그인에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>QAIL Closure Document</CardTitle>
          <CardDescription>계정 ID로 로그인하세요</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={signIn} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="si-id">ID</Label>
              <Input id="si-id" value={loginId} onChange={(e) => setLoginId(e.target.value)} required autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-password">Password</Label>
              <Input id="si-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              로그인
            </Button>
            <p className="pt-1 text-center text-xs text-muted-foreground">
              계정이 필요하면 관리자에게 문의하세요.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}