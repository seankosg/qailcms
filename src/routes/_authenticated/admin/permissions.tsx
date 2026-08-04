import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROLE_LABELS, type AppRole } from "@/types/enums";
import {
  canonicalAllowed, diffAgainstCanonical, RCL_CANON_CELL_COUNT,
} from "@/lib/auth/rcl-canonical";
import { RotateCcw, Save, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/permissions")({
  // §1(2026-08-04): 이 화면만 admin 단독. 부모 /admin 가드(admin||superuser)는 그대로 둔다.
  beforeLoad: async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({
    meta: [
      { title: "권한 관리 — QAIL CMS" },
      { name: "description", content: "역할 × 범위 × 동작 권한표를 관리하고 변경 이력을 추적합니다." },
      { property: "og:title", content: "권한 관리 — QAIL CMS" },
      { property: "og:description", content: "역할 × 범위 × 동작 권한표 관리 화면." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PermissionsAdminPage,
});

const ROLES: AppRole[] = ["user", "senior_user", "d_superuser", "superuser", "admin", "super_guest", "guest"];
const SCOPES = [
  { key: "own", label: "Own (본인)" },
  { key: "own_team", label: "Own Team (같은 팀)" },
  { key: "other_team", label: "Other Team (다른 팀)" },
] as const;
const ACTIONS = [
  { key: "read", label: "R", full: "조회" },
  { key: "write", label: "W", full: "수정" },
  { key: "delete", label: "D", full: "삭제" },
  { key: "import", label: "I", full: "임포트" },
  { key: "export", label: "E", full: "익스포트" },
] as const;

type Row = { role: AppRole; scope: string; action: string; allowed: boolean };
const ck = (role: string, scope: string, action: string) => `${role}|${scope}|${action}`;

function PermissionsAdminPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const permsQ = useQuery({
    queryKey: ["rcl_permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rcl_permissions").select("role,scope,action,allowed");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["rcl_role_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rcl_role_counts");
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as { role: string; cnt: number }[]) m[r.role] = Number(r.cnt);
      return m;
    },
  });

  const modulesQ = useQuery({
    queryKey: ["rcl_module_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rcl_module_config").select("module,table_name,owning_team,owner_cols").order("module");
      if (error) throw error;
      return data ?? [];
    },
  });

  const auditQ = useQuery({
    queryKey: ["rcl_permissions_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rcl_permissions_audit")
        .select("id,changed_at,changed_by_name,role,scope,action,old_allowed,new_allowed,op")
        .order("changed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const teamsQ = useQuery({
    queryKey: ["team_master_names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("team_master").select("name").order("name");
      if (error) throw error;
      return (data ?? []).map((t: any) => String(t.name));
    },
  });

  const teamCountsQ = useQuery({
    queryKey: ["rcl_team_user_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rcl_team_user_counts" as any);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as { team: string; cnt: number }[]) m[r.team] = Number(r.cnt);
      return m;
    },
  });

  const moduleAuditQ = useQuery({
    queryKey: ["rcl_module_config_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rcl_module_config_audit" as any)
        .select("id,changed_at,changed_by_name,module,old_team,new_team")
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [teamEdit, setTeamEdit] = useState<{ module: string; from: string | null; to: string | null } | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);

  const saveOwningTeam = async () => {
    if (!teamEdit) return;
    setTeamSaving(true);
    try {
      const { error } = await supabase.rpc("rcl_set_module_owning_team" as any, {
        _module: teamEdit.module,
        _team: teamEdit.to,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["rcl_module_config"] });
      await qc.invalidateQueries({ queryKey: ["rcl_module_config_audit"] });
      await qc.invalidateQueries({ queryKey: ["rcl_can"] });
      toast.success(`${teamEdit.module} 주관팀 → ${teamEdit.to ?? "(없음)"} 반영`);
      setTeamEdit(null);
    } catch (e) {
      toast.error(`주관팀 변경 실패: ${(e as Error).message}`);
    } finally {
      setTeamSaving(false);
    }
  };

  const base = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of permsQ.data ?? []) m[ck(r.role, r.scope, r.action)] = r.allowed;
    return m;
  }, [permsQ.data]);

  const value = (key: string) => (key in draft ? draft[key]! : (base[key] ?? false));

  // 검사 기준 (ㄷ): 정본 표와의 칸 대조. guest 계열은 정본 미확정이라 제외.
  const canonDiffs = useMemo(
    () => diffAgainstCanonical(permsQ.data ?? []),
    [permsQ.data],
  );

  const diffs = useMemo(
    () => Object.entries(draft).filter(([k, v]) => (base[k] ?? false) !== v).map(([k, v]) => {
      const [role, scope, action] = k.split("|") as [AppRole, string, string];
      return { key: k, role, scope, action, from: base[k] ?? false, to: v };
    }),
    [draft, base],
  );

  const toggle = (role: AppRole, scope: string, action: string) => {
    if (role === "admin") return;
    const key = ck(role, scope, action);
    setDraft((d) => ({ ...d, [key]: !value(key) }));
  };

  const save = async () => {
    setSaving(true);
    setVerifyMsg(null);
    try {
      for (const d of diffs) {
        const { error } = await supabase
          .from("rcl_permissions")
          .update({ allowed: d.to })
          .eq("role", d.role).eq("scope", d.scope).eq("action", d.action);
        if (error) throw error;
      }
      // A-5 반영 확인: 저장 직후 서버 값을 다시 읽어 대조
      const { data, error } = await supabase.from("rcl_permissions").select("role,scope,action,allowed");
      if (error) throw error;
      const server: Record<string, boolean> = {};
      for (const r of (data ?? []) as Row[]) server[ck(r.role, r.scope, r.action)] = r.allowed;
      const mismatched = diffs.filter((d) => server[d.key] !== d.to);
      setVerifyMsg(
        mismatched.length === 0
          ? `반영 확인: 변경 ${diffs.length}칸 / 서버 재조회 일치 ${diffs.length}칸 · 불일치 0칸`
          : `반영 불일치 ${mismatched.length}칸 — ${mismatched.map((m) => ck(m.role, m.scope, m.action)).join(", ")}`,
      );
      setDraft({});
      await qc.invalidateQueries({ queryKey: ["rcl_permissions"] });
      await qc.invalidateQueries({ queryKey: ["rcl_permissions_audit"] });
      await qc.invalidateQueries({ queryKey: ["rcl_can"] });
      // §1-4: 재조회 대조가 끝난 뒤에만 성공 토스트. 불일치가 있으면 실패로 알린다.
      if (mismatched.length === 0) {
        toast.success(`권한 ${diffs.length}칸 저장 완료 · 서버 재조회 일치`);
      } else {
        toast.error(`저장 반영 불일치 ${mismatched.length}칸 / 변경 ${diffs.length}칸 — 값이 서버에 반영되지 않았습니다.`);
      }
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const revert = async (a: { role: string; scope: string; action: string; old_allowed: boolean | null }) => {
    if (a.old_allowed === null) { toast.error("되돌릴 이전 값이 없습니다."); return; }
    const { error } = await supabase
      .from("rcl_permissions").update({ allowed: a.old_allowed })
      .eq("role", a.role as AppRole).eq("scope", a.scope).eq("action", a.action);
    if (error) { toast.error(`되돌리기 실패: ${error.message}`); return; }
    await qc.invalidateQueries({ queryKey: ["rcl_permissions"] });
    await qc.invalidateQueries({ queryKey: ["rcl_permissions_audit"] });
    toast.success(`되돌림: ${a.role} · ${a.scope} · ${a.action} → ${a.old_allowed ? "Y" : "N"}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">권한 관리</h1>
          <p className="text-sm text-muted-foreground">
            역할 × 범위 × 동작 권한표(정본). 이 표를 <code>rcl_can</code>이 직접 읽습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {diffs.length > 0 && <Badge variant="secondary">{diffs.length}칸 변경됨</Badge>}
          <Button size="sm" disabled={diffs.length === 0 || saving} onClick={() => setConfirmOpen(true)}>
            <Save className="mr-1 h-4 w-4" /> 저장
          </Button>
          {diffs.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setDraft({})}>취소</Button>
          )}
        </div>
      </div>

      {verifyMsg && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <ShieldCheck className="mr-1 inline h-4 w-4 text-primary" />
          {verifyMsg}
        </div>
      )}

      {permsQ.data && (
        <div className={`rounded-md border px-3 py-2 text-sm ${canonDiffs.length === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
          <ShieldCheck className="mr-1 inline h-4 w-4" />
          정본 대조 (ㄷ): 어긋난 칸 {canonDiffs.length} / {RCL_CANON_CELL_COUNT}칸(4역할 × 3범위 × 5동작)
          {canonDiffs.length > 0 && (
            <span className="ml-2 font-mono text-xs">
              {canonDiffs.map((d) => `${d.role}·${d.scope}·${d.action}: live ${d.live ? "Y" : "N"} / 정본 ${d.canon ? "Y" : "N"}`).join(" · ")}
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">guest · super_guest 는 정본 미확정(BACKLOG #0804)으로 대조 제외.</span>
          <div className="mt-1 text-xs text-muted-foreground">
            어긋난 칸은 <b>알림만</b> 합니다. 자동 정정하지 않습니다 — 어느 쪽이 맞는지는 지시자가 정합니다.
            {" "}격자 값은 <b>DB(rcl_permissions)</b> 에서 읽고 기준표는 <b>코드(src/lib/auth/rcl-canonical.ts)</b> 에 있습니다.
            정본이 바뀌면 이 파일을 고치고 <b>배포</b>해야 배너 기준이 바뀝니다.
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">권한 격자</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <th rowSpan={2} className="border px-2 py-1 text-left align-bottom">역할</th>
                {SCOPES.map((s) => (
                  <th key={s.key} colSpan={5} className="border px-2 py-1 text-center">{s.label}</th>
                ))}
              </tr>
              <tr>
                {SCOPES.flatMap((s) =>
                  ACTIONS.map((a) => (
                    <th key={`${s.key}-${a.key}`} className="border px-2 py-1 text-center text-xs font-normal text-muted-foreground" title={a.full}>
                      {a.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => {
                const locked = role === "admin";
                return (
                  <tr key={role} className={locked ? "bg-muted/60 text-muted-foreground" : undefined}>
                    <td className="border px-2 py-1 whitespace-nowrap">
                      <span className="font-medium">{ROLE_LABELS[role]}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{countsQ.data?.[role] ?? 0}명</span>
                      {locked && <Badge variant="outline" className="ml-2 text-[10px]">잠금</Badge>}
                    </td>
                    {SCOPES.flatMap((s) =>
                      ACTIONS.map((a) => {
                        const key = ck(role, s.key, a.key);
                        const changed = key in draft && (base[key] ?? false) !== draft[key];
                        const canon = canonicalAllowed(role, s.key, a.key);
                        const offCanon = canon !== null && canon !== (base[key] ?? false);
                        return (
                          <td
                            key={key}
                            title={offCanon ? `정본 ${canon ? "Y" : "N"} 과 어긋남` : undefined}
                            className={`border px-2 py-1 text-center ${changed ? "bg-amber-100 dark:bg-amber-900/40" : offCanon ? "bg-destructive/15 ring-1 ring-destructive/40" : ""}`}
                          >
                            <Checkbox
                              checked={value(key)}
                              disabled={locked}
                              onCheckedChange={() => toggle(role, s.key, a.key)}
                              aria-label={`${ROLE_LABELS[role]} ${s.label} ${a.full}`}
                            />
                          </td>
                        );
                      }),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">모듈 주관팀 (읽기 전용)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>모듈</TableHead><TableHead>테이블</TableHead>
                <TableHead>주관팀</TableHead><TableHead>담당 판정 컬럼</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(modulesQ.data ?? []).map((m: any) => (
                <TableRow key={m.module}>
                  <TableCell className="font-medium">{m.module}</TableCell>
                  <TableCell className="font-mono text-xs">{m.table_name}</TableCell>
                  <TableCell>{m.owning_team ?? <span className="text-muted-foreground">없음</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{(m.owner_cols ?? []).join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            주관팀 사용자는 해당 모듈 전 행을 Own Team 으로 취급합니다(본인 담당 행은 Own 우선).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">변경 이력</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시각</TableHead><TableHead>변경자</TableHead><TableHead>칸</TableHead>
                <TableHead>변경</TableHead><TableHead className="text-right">되돌리기</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(auditQ.data ?? []).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(a.changed_at).toLocaleString("ko-KR", { timeZone: "Asia/Qatar" })}</TableCell>
                  <TableCell className="text-xs">{a.changed_by_name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{a.role} · {a.scope} · {a.action}</TableCell>
                  <TableCell className="text-xs">
                    {a.old_allowed === null ? "—" : a.old_allowed ? "Y" : "N"} → {a.new_allowed === null ? "—" : a.new_allowed ? "Y" : "N"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={a.old_allowed === null || a.role === "admin"} onClick={() => revert(a)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(auditQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">이력이 없습니다.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>권한 {diffs.length}칸을 변경합니다</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {diffs.map((d) => (
                  <div key={d.key} className="font-mono text-xs">
                    {ROLE_LABELS[d.role]} · {d.scope} · {d.action} : {d.from ? "Y" : "N"} → {d.to ? "Y" : "N"}
                  </div>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void save(); }} disabled={saving}>
              저장
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
