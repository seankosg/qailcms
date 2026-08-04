import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createAppUser } from "@/lib/admin/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, UserPlus, ExternalLink } from "lucide-react";
import { DEFAULT_PASSWORD, PASSWORD_HINT, PASSWORD_REGEX, ROLE_LABELS, type AppRole } from "@/types/enums";
import { useTeamOptions } from "@/lib/team/team-master";

type RosterRow = {
  id: string;
  name: string;
  name_norm: string;
  name_variants: string[] | null;
  verified: boolean | null;
  is_active: boolean | null;
  merged_into_id: string | null;
  merged_into_name: string | null;
  note: string | null;
  cnt_tm: number; cnt_abd: number; cnt_sm: number; cnt_spl: number; cnt_wrt: number; cnt_total: number;
  has_account: boolean;
  account_user_id: string | null;
  account_login_id: string | null;
  account_team: string | null;
  similar_candidates: { name: string; score: number }[];
};

const ROLES: AppRole[] = ["admin", "superuser", "senior_user", "user", "super_guest", "guest", "d_superuser"];
type Filter = "all" | "no_account" | "zero_usage" | "merged";
type SortKey = "name" | "cnt_total" | "account";

export function HdecRosterTab({ kind = "eng" as "eng" | "pic" }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["hdec-roster", kind],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("hdec_roster_list", { _kind: kind });
      if (error) throw error;
      return data as { rows: RosterRow[] };
    },
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [target, setTarget] = useState<RosterRow | null>(null);

  const all = (data?.rows ?? []) as RosterRow[];
  const unmerged = useMemo(() => all.filter((r) => !r.merged_into_id), [all]);

  const counts = useMemo(() => ({
    all: unmerged.length,
    no_account: unmerged.filter((r) => !r.has_account).length,
    zero_usage: unmerged.filter((r) => Number(r.cnt_total) === 0).length,
    merged: all.length - unmerged.length,
  }), [all, unmerged]);

  const rows = useMemo(() => {
    let base = filter === "merged" ? all.filter((r) => r.merged_into_id) : unmerged;
    if (filter === "no_account") base = base.filter((r) => !r.has_account);
    if (filter === "zero_usage") base = base.filter((r) => Number(r.cnt_total) === 0);
    const q = search.trim().toLowerCase();
    if (q) base = base.filter((r) => `${r.name} ${(r.name_variants ?? []).join(" ")}`.toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      if (sortKey === "cnt_total") return Number(b.cnt_total) - Number(a.cnt_total);
      if (sortKey === "account") return Number(a.has_account) - Number(b.has_account) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [all, unmerged, filter, search, sortKey]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>
            {kind === "eng" ? "HDEC ENG 명부" : "HDEC PIC 명부"} ({rows.length}/{counts.all})
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            HDEC 소속 외국인 직원 명부. 계정 생성 대상.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색…" className="h-9 w-44" />
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 ({counts.all})</SelectItem>
              <SelectItem value="no_account">계정 없음 ({counts.no_account})</SelectItem>
              <SelectItem value="zero_usage">등장 0건 ({counts.zero_usage})</SelectItem>
              <SelectItem value="merged">병합됨 ({counts.merged})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">이름순</SelectItem>
              <SelectItem value="cnt_total">등장 많은순</SelectItem>
              <SelectItem value="account">계정 없음 먼저</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["hdec-roster", kind] })}>
            <RefreshCw className="mr-1 h-4 w-4" />새로고침
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <div className="overflow-auto max-h-[calc(100vh-300px)]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>변형 표기</TableHead>
                  <TableHead className="text-right">TM</TableHead>
                  <TableHead className="text-right">ABD</TableHead>
                  <TableHead className="text-right">SM</TableHead>
                  <TableHead className="text-right">SPL</TableHead>
                  <TableHead className="text-right">WRT</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                  <TableHead>유사 표기 후보</TableHead>
                  <TableHead>계정</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const zero = Number(r.cnt_total) === 0;
                  const noCand = zero && (r.similar_candidates ?? []).length === 0;
                  return (
                    <TableRow key={r.id} className={zero ? "bg-muted/40" : undefined}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.merged_into_name && (
                          <Badge variant="outline" className="ml-2 text-[10px]">→ {r.merged_into_name}</Badge>
                        )}
                        {noCand && <Badge variant="destructive" className="ml-2 text-[10px]">계열 없음</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(r.name_variants ?? []).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.cnt_tm}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cnt_abd}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cnt_sm}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cnt_spl}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cnt_wrt}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.cnt_total}</TableCell>
                      <TableCell className="text-xs">
                        {(r.similar_candidates ?? []).length === 0 ? "—" :
                          (r.similar_candidates ?? []).map((c) => (
                            <Badge key={c.name} variant="secondary" className="mr-1 text-[10px]">
                              {c.name} · {c.score}
                            </Badge>
                          ))}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.has_account
                          ? <span className="font-mono">{r.account_login_id ?? "있음"}{r.account_team ? ` · ${r.account_team}` : ""}</span>
                          : <Badge variant="outline" className="text-[10px]">없음</Badge>}
                      </TableCell>
                      <TableCell>
                        {r.has_account ? (
                          <Button variant="ghost" size="sm" disabled className="text-xs">
                            <ExternalLink className="mr-1 h-3 w-3" />계정 탭
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setTarget(r)}>
                            <UserPlus className="mr-1 h-3 w-3" />계정 생성
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">해당 조건의 행이 없습니다.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <CreateAccountDialog
        kind={kind}
        row={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["hdec-roster", kind] });
          qc.invalidateQueries({ queryKey: ["admin-users"] });
        }}
      />
    </Card>
  );
}

function CreateAccountDialog({
  kind, row, onClose, onDone,
}: { kind: "eng" | "pic"; row: RosterRow | null; onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createAppUser);
  const { data: teams = [] } = useTeamOptions();
  const [loginId, setLoginId] = useState("");
  const [team, setTeam] = useState<string>("__none__");
  const [role, setRole] = useState<AppRole>("user");
  const [pw, setPw] = useState(DEFAULT_PASSWORD);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; modules: { table: string; updated: number }[] } | null>(null);

  const submit = async () => {
    if (!row) return;
    if (!/^[a-z0-9._-]+$/.test(loginId.trim().toLowerCase())) return toast.error("Login ID는 영문 소문자·숫자·. _ - 만 사용");
    if (!PASSWORD_REGEX.test(pw)) return toast.error(PASSWORD_HINT);
    setBusy(true);
    try {
      const res: any = await create({
        data: {
          login_id: loginId.trim().toLowerCase(),
          display_name: row.name,
          name: row.name, // 명부 대표 이름 고정
          user_type: kind === "eng" ? "hdec_eng" : "hdec_pic",
          role,
          temp_password: pw,
          team: team === "__none__" ? null : team,
        },
      });
      const userId = res?.id;
      let recalc: any = null;
      if (userId) {
        // 명부 행 ↔ 계정 자동 연결
        const { error: linkErr } = await (supabase as any).rpc("hdec_roster_update", {
          _kind: kind, _id: row.id, _linked_user_id: userId,
        });
        if (linkErr) toast.error(`명부 연결 실패: ${linkErr.message}`);
        const { data, error } = await (supabase as any).rpc("hdec_recalc_owner_for_user", {
          _user_id: userId, _reason: "account_create",
        });
        if (error) toast.error(`소유권 재계산 실패: ${error.message}`);
        else recalc = data;
      }
      setResult(recalc ? { total: recalc.total, modules: recalc.modules } : { total: 0, modules: [] });
      toast.success(`계정 생성됨 — 소유권 반영 ${recalc?.total ?? 0}건`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => { setResult(null); setLoginId(""); setPw(DEFAULT_PASSWORD); onClose(); };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>명부 계정 생성</DialogTitle>
          <DialogDescription>
            이름은 명부 대표 이름으로 고정되며 수정할 수 없습니다. 생성 직후 소유권이 자동 재계산됩니다.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 text-sm">
            <div className="font-medium">소유권 재계산 결과 — 총 {result.total}건</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.modules.map((m) => <li key={m.table}>{m.table}: {m.updated}건</li>)}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">이름 (고정)</div>
              <Input value={row?.name ?? ""} readOnly disabled />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Login ID</div>
              <Input value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())} placeholder="예: ajmal" className="font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">팀</div>
                <Select value={team} onValueChange={setTeam}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.code} — {t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">역할</div>
                <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">임시 비밀번호 · {PASSWORD_HINT}</div>
              <Input value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>{result ? "닫기" : "취소"}</Button>
          {!result && <Button onClick={submit} disabled={busy}>{busy ? "생성 중…" : "생성"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
