import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  resetUserPassword, updateUserRole, updateUserProfileFields,
  deleteAppUser, updateLoginId, suggestLoginIds, bulkCreateAppUsers,
  baseLoginIdFromName,
} from "@/lib/admin/users.functions";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Trash2, Download, Loader2, UserPlus } from "lucide-react";
import { ROLE_LABELS, PASSWORD_REGEX, PASSWORD_HINT, DEFAULT_PASSWORD, type AppRole } from "@/types/enums";
import { useTeamOptions } from "@/lib/team/team-master";
import { todayInDoha } from "@/lib/time/doha";

const ROLES: AppRole[] = ["admin", "superuser", "senior_user", "user", "super_guest", "guest", "d_superuser"];

export interface PersonRow {
  source: "roster" | "profile";
  roster_id: string | null;
  name: string;
  name_norm: string;
  user_id: string | null;
  login_id: string | null;
  display_name: string | null;
  user_type: string | null;
  team: string | null;
  team_suggest: string | null;
  is_active: boolean | null;
  has_account: boolean;
  dual_roster?: boolean;
  role: string | null;
  tm: number; abd: number; sm: number; spl: number; wrt: number; total: number;
  first_seen: string | null;
  last_seen: string | null;
}

type BulkResult = {
  name: string; login_id: string; team: string | null;
  temp_password: string | null; ok: boolean; error: string | null;
  recalc: Record<string, number>; recalc_total: number;
};

const d10 = (v: string | null) => (v ? String(v).slice(0, 10) : "—");

export function usePeopleList(kind: "pic" | "eng", includeOrphans: boolean) {
  return useQuery({
    queryKey: ["hdec-people", kind, includeOrphans],
    queryFn: async (): Promise<PersonRow[]> => {
      const { data, error } = await (supabase as any).rpc("hdec_people_list", {
        _kind: kind, _include_orphans: includeOrphans,
      });
      if (error) throw error;
      return (data ?? []) as PersonRow[];
    },
  });
}

export function HdecPeopleTab({ kind }: { kind: "pic" | "eng" }) {
  const qc = useQueryClient();
  const teams = useTeamOptions();
  const [includeOrphans, setIncludeOrphans] = useState(false);
  const { data: rows = [], isLoading } = usePeopleList(kind, includeOrphans);

  const resetPw = useServerFn(resetUserPassword);
  const updRole = useServerFn(updateUserRole);
  const updProfile = useServerFn(updateUserProfileFields);
  const del = useServerFn(deleteAppUser);
  const updLogin = useServerFn(updateLoginId);
  const suggest = useServerFn(suggestLoginIds);
  const bulkCreate = useServerFn(bulkCreateAppUsers);
  // §5(2026-08-11) 계정 생성은 서버가 최상위 전용. users.tsx 와 같은 판정 하나만 쓴다.
  const me = useCurrentUser();
  const canManageAccounts = !!me.data?.isSystemAdmin;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["hdec-people"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const [search, setSearch] = useState("");
  const [onlyNoAccount, setOnlyNoAccount] = useState(false);
  const [onlyZeroUsage, setOnlyZeroUsage] = useState(false);

  // 계정 없는 행의 편집 상태(login_id / team)
  const [draft, setDraft] = useState<Record<string, { login_id: string; team: string; conflicted: boolean }>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  // 임시 비밀번호 — 신규 계정 다이얼로그와 동일하게 기본값 DEFAULT_PASSWORD, 전원 동일 적용.
  const [bulkPw, setBulkPw] = useState(DEFAULT_PASSWORD);

  const noAccountNames = useMemo(
    () => rows.filter((r) => !r.has_account).map((r) => r.name),
    [rows],
  );

  // login_id 자동 제안 — 목록이 바뀌면 서버에서 충돌 회피된 값을 받아온다.
  useEffect(() => {
    if (!noAccountNames.length) return;
    let cancelled = false;
    (async () => {
      try {
        const s = (await suggest({ data: { names: noAccountNames } })) as any[];
        if (cancelled) return;
        setDraft((prev) => {
          const next = { ...prev };
          for (const it of s) {
            if (next[it.name]) continue;
            const row = rows.find((r) => r.name === it.name);
            next[it.name] = {
              login_id: it.login_id,
              team: row?.team_suggest ?? "",
              conflicted: !!it.conflicted || !!it.needs_edit,
            };
          }
          return next;
        });
      } catch (e: any) {
        // 제안 실패를 조용히 삼키면 login_id 가 빈 값으로 전송된다 — 표면화한다.
        console.error("suggestLoginIds failed", e);
        toast.warning("Login ID 자동 제안에 실패했습니다. 이름 규칙으로 임시 생성합니다.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noAccountNames.join("|")]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyNoAccount && r.has_account) return false;
      if (onlyZeroUsage && r.total > 0) return false;
      if (q) {
        const hay = `${r.name} ${r.login_id ?? ""} ${r.team ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, onlyNoAccount, onlyZeroUsage]);

  const totalCount = rows.length;
  const withAccount = rows.filter((r) => r.has_account).length;
  const withoutAccount = totalCount - withAccount;

  const selectedRows = filtered.filter((r) => !r.has_account && selected[r.name]);

  const runCreate = async (targets: PersonRow[]) => {
    if (!targets.length) return;
    if (!PASSWORD_REGEX.test(bulkPw)) { toast.error(PASSWORD_HINT); return; }
    setCreating(true);
    try {
      // login_id 폴백 — 서버 제안이 아직 도착하지 않았거나 실패한 경우에도
      // 빈 값으로 전송되지 않도록 이름 규칙 + 충돌 회피로 즉석 생성한다.
      const taken = new Set<string>(
        rows.map((r) => String(r.login_id ?? "").toLowerCase()).filter(Boolean),
      );
      const payload: { name: string; login_id: string; team: string | null }[] = [];
      const invalid: string[] = [];
      for (const r of targets) {
        let id = (draft[r.name]?.login_id ?? "").trim().toLowerCase();
        if (!id) {
          const base = baseLoginIdFromName(r.name) || "user";
          let cand = base;
          let n = 1;
          while (taken.has(cand)) { n += 1; cand = `${base}${n}`; }
          id = cand;
        }
        if (!/^[a-z0-9._-]+$/.test(id)) { invalid.push(r.name); continue; }
        taken.add(id);
        payload.push({
          name: r.name,
          login_id: id,
          team: (draft[r.name]?.team ?? "").trim() || null,
        });
      }
      if (invalid.length) {
        toast.error(`Login ID를 만들 수 없는 이름 ${invalid.length}건: ${invalid.join(", ")} — 표에서 직접 입력하세요.`);
      }
      if (!payload.length) { setCreating(false); return; }
      const res = (await bulkCreate({ data: { kind, rows: payload, temp_password: bulkPw } })) as BulkResult[];
      setResults(res);
      const ok = res.filter((r) => r.ok).length;
      const fail = res.length - ok;
      if (fail === 0) toast.success(`${ok}건 생성 완료`);
      else toast.warning(`${ok}건 생성 · ${fail}건 실패`);
      setSelected({});
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const label = kind === "pic" ? "HDEC PIC" : "HDEC ENG";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          {label} {totalCount}
          <Badge variant="outline" className="text-[11px]">미생성 {withoutAccount}</Badge>
          <Badge variant="secondary" className="text-[11px]">계정 {withAccount}</Badge>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색…" className="h-9 w-44" />
          <Button variant={onlyNoAccount ? "default" : "outline"} size="sm" onClick={() => setOnlyNoAccount((v) => !v)}>
            계정 없음 {withoutAccount}
          </Button>
          <Button variant={onlyZeroUsage ? "default" : "outline"} size="sm" onClick={() => setOnlyZeroUsage((v) => !v)}>
            등장 0건 {rows.filter((r) => r.total === 0).length}
          </Button>
          <Button variant={includeOrphans ? "default" : "outline"} size="sm" onClick={() => setIncludeOrphans((v) => !v)}>
            명부 밖 계정 포함
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportPeopleCsv(filtered, kind)}>
            <Download className="mr-1 h-4 w-4" />Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedRows.length > 0 && (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>{selectedRows.length}건 선택됨</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected({})}>선택 해제</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={creating || !canManageAccounts} title={!canManageAccounts ? "계정 생성은 System Administrator 전용입니다." : undefined}>
                    {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1 h-4 w-4" />}
                    선택 항목 계정 생성
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>계정 생성 대상 {selectedRows.length}명</AlertDialogTitle>
                    <AlertDialogDescription>
                      아래 이름 전부에 대해 계정을 생성합니다. 사람이 아닌 값(예: NO SERVICES, 외부)이 섞여 있지 않은지 확인하세요.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="max-h-64 overflow-auto rounded-md border p-2 text-xs">
                    <ol className="list-decimal space-y-0.5 pl-5">
                      {selectedRows.map((r) => (
                        <li key={r.name_norm}>
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 font-mono text-muted-foreground">
                            {(draft[r.name]?.login_id ?? "").trim() || "(login_id 미입력)"}
                          </span>
                          <span className="ml-2 text-muted-foreground">등장 {r.total}건</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">임시 비밀번호 (전원 동일)</label>
                    <Input value={bulkPw} onChange={(e) => setBulkPw(e.target.value)} className="h-9 font-mono" />
                    <p className="text-[11px] text-muted-foreground">
                      기본값 <code className="font-mono">{DEFAULT_PASSWORD}</code>. 첫 로그인 시 변경이 강제됩니다.
                    </p>
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={() => runCreate(selectedRows)}>생성</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중…</div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selectedRows.length > 0 && selectedRows.length === filtered.filter((r) => !r.has_account).length}
                      onCheckedChange={(v) => {
                        const next: Record<string, boolean> = {};
                        if (v) for (const r of filtered) if (!r.has_account) next[r.name] = true;
                        setSelected(next);
                      }}
                    />
                  </TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>계정 상태</TableHead>
                  <TableHead>Login ID</TableHead>
                  <TableHead>팀</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>활성</TableHead>
                  <TableHead className="text-right">TM</TableHead>
                  <TableHead className="text-right">ABD</TableHead>
                  <TableHead className="text-right">SM</TableHead>
                  <TableHead className="text-right">SPL</TableHead>
                  <TableHead className="text-right">WRT</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                  <TableHead>최초</TableHead>
                  <TableHead>최종</TableHead>
                  <TableHead className="text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={16} className="py-8 text-center text-sm text-muted-foreground">해당 조건의 행이 없습니다.</TableCell></TableRow>
                )}
                {filtered.map((r) => {
                  const d = draft[r.name] ?? { login_id: "", team: r.team_suggest ?? "", conflicted: false };
                  return (
                    <TableRow key={r.name_norm} className={r.has_account ? "" : "bg-amber-50/40 dark:bg-amber-950/10"}>
                      <TableCell>
                        {!r.has_account && (
                          <Checkbox
                            checked={!!selected[r.name]}
                            onCheckedChange={(v) => setSelected((p) => ({ ...p, [r.name]: !!v }))}
                          />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {r.name}
                        {r.source === "profile" && <Badge variant="outline" className="ml-1 text-[10px]">명부 밖</Badge>}
                        {r.dual_roster && (
                          <Badge variant="outline" className="ml-1 text-[10px] border-primary/40 text-primary">겸직(PIC+ENG)</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.has_account ? (
                          r.user_type && !r.dual_roster && r.user_type !== (kind === "pic" ? "hdec_pic" : "hdec_eng") ? (
                            <Badge variant="secondary" className="text-[10px]">
                              계정 있음(다른 구분으로 등록됨: {r.user_type})
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">계정 있음</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">계정 없음</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.has_account ? (
                          <LoginIdCell value={r.login_id ?? ""} onSave={async (v) => {
                            await updLogin({ data: { user_id: r.user_id!, login_id: v } });
                            invalidate();
                          }} />
                        ) : (
                          <div className="flex items-center gap-1">
                            <Input
                              value={d.login_id}
                              onChange={(e) => setDraft((p) => ({ ...p, [r.name]: { ...d, login_id: e.target.value.toLowerCase() } }))}
                              className="h-7 w-32 font-mono text-xs"
                            />
                            {d.conflicted && <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">중복회피</Badge>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.has_account ? (
                          <Select value={r.team ?? "__none__"} onValueChange={async (v) => {
                            try { await updProfile({ data: { user_id: r.user_id!, team: v === "__none__" ? null : v } }); invalidate(); }
                            catch (e: any) { toast.error(e.message); }
                          }}>
                            <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.code}>{t.code}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select value={d.team || "__none__"} onValueChange={(v) =>
                            setDraft((p) => ({ ...p, [r.name]: { ...d, team: v === "__none__" ? "" : v } }))}>
                            <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.code}>{t.code}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.has_account ? (
                          <Select value={r.role ?? "user"} onValueChange={async (v) => {
                            try { await updRole({ data: { user_id: r.user_id!, role: v as any } }); toast.success("역할 변경됨"); invalidate(); }
                            catch (e: any) { toast.error(e.message); }
                          }}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>{ROLES.map((x) => <SelectItem key={x} value={x}>{ROLE_LABELS[x]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.has_account ? (
                          <Switch checked={!!r.is_active} onCheckedChange={async (v) => {
                            try { await updProfile({ data: { user_id: r.user_id!, is_active: v } }); invalidate(); }
                            catch (e: any) { toast.error(e.message); }
                          }} />
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.tm.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.abd.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.sm.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.spl.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.wrt.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{r.total.toLocaleString()}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{d10(r.first_seen)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{d10(r.last_seen)}</TableCell>
                      <TableCell className="text-right">
                        {r.has_account ? (
                          <>
                            <ResetPasswordButton onReset={async (pw) => {
                              try { await resetPw({ data: { user_id: r.user_id!, temp_password: pw } }); toast.success("임시 PW 재발급됨"); invalidate(); }
                              catch (e: any) { toast.error(e.message); }
                            }} />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
                                  <AlertDialogDescription>{r.login_id} 계정을 완전히 삭제합니다. 되돌릴 수 없습니다.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>취소</AlertDialogCancel>
                                  <AlertDialogAction onClick={async () => {
                                    try { await del({ data: { user_id: r.user_id! } }); toast.success("삭제됨"); invalidate(); }
                                    catch (e: any) { toast.error(e.message); }
                                  }}>삭제</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" disabled={creating || !canManageAccounts} title={!canManageAccounts ? "계정 생성은 System Administrator 전용입니다." : undefined} onClick={() => runCreate([r])}>
                            <UserPlus className="mr-1 h-3.5 w-3.5" />계정 생성
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <BulkResultDialog results={results} onClose={() => setResults(null)} kind={kind} />
    </Card>
  );
}

function BulkResultDialog({ results, onClose, kind }: { results: BulkResult[] | null; onClose: () => void; kind: "pic" | "eng" }) {
  const ok = (results ?? []).filter((r) => r.ok);
  const fail = (results ?? []).filter((r) => !r.ok);
  return (
    <Dialog open={!!results} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>계정 생성 결과 — 성공 {ok.length}건 · 실패 {fail.length}건</DialogTitle>
          <DialogDescription>
            임시 비밀번호는 이 화면에서만 확인할 수 있습니다. 반드시 CSV로 내려받아 전달하세요.
            첫 로그인 시 비밀번호 변경이 강제됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>Login ID</TableHead>
                <TableHead>임시 비밀번호</TableHead>
                <TableHead>팀</TableHead>
                <TableHead className="text-right">소유권 재계산</TableHead>
                <TableHead>결과</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results ?? []).map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.login_id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.temp_password ?? "—"}</TableCell>
                  <TableCell>{r.team ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.ok ? (
                      <span title={Object.entries(r.recalc).map(([k, v]) => `${k}: ${v}`).join(" / ")}>
                        {r.recalc_total.toLocaleString()}건
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.ok ? <Badge variant="secondary">성공</Badge> : <span className="text-destructive">{r.error}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button onClick={() => downloadResultCsv(results ?? [], kind)} disabled={!ok.length}>
            <Download className="mr-1 h-4 w-4" />CSV 다운로드
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function csvDownload(name: string, header: string[], lines: string[][]) {
  const csv = [header.join(",")].concat(lines.map((l) => l.map((c) => String(c ?? "").replaceAll(",", " ")).join(","))).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function downloadResultCsv(results: BulkResult[], kind: "pic" | "eng") {
  csvDownload(
    `CMS_NewAccounts_${kind.toUpperCase()}_${todayInDoha()}.csv`,
    ["이름", "Login ID", "임시 비밀번호", "팀", "소유권 재계산", "결과"],
    results.map((r) => [r.name, r.login_id, r.temp_password ?? "", r.team ?? "", r.ok ? String(r.recalc_total) : "", r.ok ? "성공" : `실패: ${r.error}`]),
  );
}

function exportPeopleCsv(rows: PersonRow[], kind: "pic" | "eng") {
  csvDownload(
    `CMS_${kind.toUpperCase()}_People_${todayInDoha()}.csv`,
    ["이름", "계정상태", "Login ID", "팀", "역할", "활성", "TM", "ABD", "SM", "SPL", "WRT", "합계", "최초", "최종"],
    rows.map((r) => [
      r.name, r.has_account ? "계정 있음" : "계정 없음", r.login_id ?? "", r.team ?? "", r.role ?? "",
      r.has_account ? (r.is_active ? "Y" : "N") : "", String(r.tm), String(r.abd), String(r.sm),
      String(r.spl), String(r.wrt), String(r.total), d10(r.first_seen), d10(r.last_seen),
    ]),
  );
}

function LoginIdCell({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  if (!editing) {
    return (
      <button className="underline-offset-2 hover:underline" onClick={() => { setV(value ?? ""); setEditing(true); }}>
        {value || "—"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value.toLowerCase())} className="h-7 w-32 font-mono" autoFocus />
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={async () => {
        const clean = v.trim().toLowerCase();
        if (!/^[a-z0-9._-]+$/.test(clean)) { toast.error("영문 소문자·숫자·. _ - 만 사용"); return; }
        try { await onSave(clean); setEditing(false); toast.success("Login ID 변경됨"); } catch (e: any) { toast.error(e.message); }
      }}>저장</Button>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(false)}>취소</Button>
    </div>
  );
}

function ResetPasswordButton({ onReset }: { onReset: (pw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(DEFAULT_PASSWORD);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><KeyRound className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>임시 비밀번호 발급</DialogTitle>
          <DialogDescription>기본값 <code className="font-mono">{DEFAULT_PASSWORD}</code>. 다음 로그인 시 변경이 강제됩니다.<br />{PASSWORD_HINT}</DialogDescription>
        </DialogHeader>
        <Input value={pw} onChange={(e) => setPw(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={async () => {
            if (!PASSWORD_REGEX.test(pw)) { toast.error(PASSWORD_HINT); return; }
            await onReset(pw); setOpen(false); setPw(DEFAULT_PASSWORD);
          }}>발급</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
