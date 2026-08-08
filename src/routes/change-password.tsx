import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { markPasswordChanged } from "@/lib/admin/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PASSWORD_REGEX, PASSWORD_HINT } from "@/types/enums";

export const Route = createFileRoute("/change-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "비밀번호 변경 — QAIL CMS" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const mark = useServerFn(markPasswordChanged);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [loading, setLoading] = useState(false);
  const isForced = me?.mustChangePassword === true;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/auth", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PASSWORD_REGEX.test(pw1)) return toast.error(PASSWORD_HINT);
    if (pw1 !== pw2) return toast.error("비밀번호가 일치하지 않습니다");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      await mark({});
      await qc.invalidateQueries({ queryKey: ["current-user"] });
      toast.success("비밀번호가 변경되었습니다");
      navigate({ to: "/my-work-space", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "변경에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>최초 로그인 시 새 비밀번호를 설정하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="p1">새 비밀번호</Label>
              <div className="relative">
                <Input
                  id="p1"
                  type={show1 ? "text" : "password"}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShow1((v) => !v)}
                  aria-label={show1 ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={show1}
                  tabIndex={-1}
                >
                  {show1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p2">새 비밀번호 확인</Label>
              <div className="relative">
                <Input
                  id="p2"
                  type={show2 ? "text" : "password"}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShow2((v) => !v)}
                  aria-label={show2 ? "비밀번호 숨기기" : "비밀번호 보기"}
                  aria-pressed={show2}
                  tabIndex={-1}
                >
                  {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                변경하기
              </Button>
              {!isForced && (
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate({ to: "/my-work-space", replace: true })}>
                  취소
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}