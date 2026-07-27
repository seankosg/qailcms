import { createFileRoute, Link } from "@tanstack/react-router";
import { todayInDoha } from "@/lib/time/doha";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listAppUsers, createAppUser, resetUserPassword, updateUserRole,
  updateUserProfileFields, deleteAppUser, updateLoginId,
} from "@/lib/admin/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Trash2, UserPlus, Download, Pencil, Check, X as XIcon } from "lucide-react";
import {
  ROLE_LABELS, USER_TYPE_LABELS, PASSWORD_REGEX, PASSWORD_HINT, DEFAULT_PASSWORD,
  type AppRole, type UserType,
} from "@/types/enums";
import { useTeamOptions } from "@/lib/team/team-master";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "사용자 관리 — QAIL CMS" }] }),
  component: UsersAdminPage,
});

const USER_TYPES: UserType[] = ["admin", "hdec_pic", "hdec_eng", "pm_pd", "hdec", "subcontractor", "subsub", "guest"];
const ROLES: AppRole[] = ["admin", "superuser", "senior_user", "user", "super_guest", "guest", "d_superuser"];

function UsersAdminPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">사용자 관리</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/masters">마스터 관리 →</Link>
        </Button>
      </div>
      <UsersTab />
    </div>
  );
}

function useMasterList(kind: "subcontractor" | "subsub" | "hdec_pic" | "hdec_eng") {
  const table =
    kind === "hdec_pic" ? "hdec_pic_master" :
    kind === "hdec_eng" ? "hdec_eng_master" : "subcontractor_master";
  const type = kind === "subsub" ? "subsub" : kind === "subcontractor" ? "sub" : null;
  return useQuery({
    queryKey: ["master", kind],
    queryFn: async () => {
      let q: any = (supabase as any).from(table).select("*").order("name");
      if (type) q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

function exportUsersXlsx(rows: any[]) {
  const header = ["Login ID","Name","User Type","Team","Sub","Sub-Sub","HDEC PIC","HDEC Eng","Role","Active","Must Change PW","Created At"];
  const csv = [header.join(",")].concat(
    rows.map((u) => [
      u.login_id ?? "",
      (u.name ?? u.display_name ?? "").toString().replaceAll(",", " "),
      u.user_type ?? "",
      u.team ?? "",
      (u.subcontractor_name ?? "").toString().replaceAll(",", " "),
      (u.subsub_name ?? "").toString().replaceAll(",", " "),
      (u.hdec_pic_name ?? "").toString().replaceAll(",", " "),
      (u.hdec_eng_name ?? "").toString().replaceAll(",", " "),
      (u.roles ?? []).join("|"),
      u.is_active ? "Y" : "N",
      u.must_change_password ? "Y" : "N",
      u.created_at ?? "",
    ].join(","))
  ).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CMS_Users_${todayInDoha()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type SortKey = "name" | "team" | "login_id" | "user_type" | "role" | "active";

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <TableHead
      onClick={() => onClick(sortKey)}
      className="cursor-pointer select-none hover:bg-muted/50"
    >
      <div className="flex items-center gap-1">
        {label}
        {active && <span className="text-xs">{dir === "asc" ? "↑" : "↓"}</span>}
      </div>
    </TableHead>
  );
}

function UsersTab() {
  const list = useServerFn(listAppUsers);
  const resetPw = useServerFn(resetUserPassword);
  const updRole = useServerFn(updateUserRole);
  const updProfile = useServerFn(updateUserProfileFields);
  const del = useServerFn(deleteAppUser);
  const updLogin = useServerFn(updateLoginId);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => list({}) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });
  const teams = useTeamOptions();

  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    const filtered = (data ?? []).filter((u: any) => {
      if (filterRole !== "all" && !(u.roles ?? []).includes(filterRole)) return false;
      if (filterType !== "all" && u.user_type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${u.login_id ?? ""} ${u.name ?? ""} ${u.display_name ?? ""} ${u.team ?? ""} ${u.subcontractor_name ?? ""} ${u.subsub_name ?? ""} ${u.hdec_pic_name ?? ""} ${u.hdec_eng_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a: any, b: any) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "name":
          av = (a.name ?? a.display_name ?? "").toString().toLowerCase();
          bv = (b.name ?? b.display_name ?? "").toString().toLowerCase();
          break;
        case "team":
          av = (a.team ?? "").toString().toLowerCase();
          bv = (b.team ?? "").toString().toLowerCase();
          break;
        case "login_id":
          av = (a.login_id ?? "").toString().toLowerCase();
          bv = (b.login_id ?? "").toString().toLowerCase();
          break;
        case "user_type":
          av = USER_TYPE_LABELS[(a.user_type ?? "") as UserType] ?? "";
          bv = USER_TYPE_LABELS[(b.user_type ?? "") as UserType] ?? "";
          break;
        case "role":
          av = ROLE_LABELS[(a.roles?.[0] ?? "guest") as AppRole] ?? "";
          bv = ROLE_LABELS[(b.roles?.[0] ?? "guest") as AppRole] ?? "";
          break;
        case "active":
          av = a.is_active ? 1 : 0;
          bv = b.is_active ? 1 : 0;
          break;
        default:
          return 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [data, filterRole, filterType, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>사용자 목록</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색…" className="h-9 w-48" />
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="역할" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 역할</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="소속" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 소속</SelectItem>
              {USER_TYPES.map((t) => <SelectItem key={t} value={t}>{USER_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportUsersXlsx(rows)}>
            <Download className="mr-1 h-4 w-4" />Export
          </Button>
          <NewUserDialog onCreated={invalidate} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <SortHeader label="사용자 이름" sortKey="name" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader label="팀" sortKey="team" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Login ID" sortKey="login_id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader label="User Type" sortKey="user_type" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <TableHead>Linked Master</TableHead>
                  <SortHeader label="역할" sortKey="role" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader label="상태" sortKey="active" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <TableHead className="text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <InlineText
                        value={u.name ?? u.display_name ?? ""}
                        onSave={async (v) => {
                          await updProfile({ data: { user_id: u.id, name: v || null, display_name: v || undefined } });
                          invalidate();
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.team ?? "__none__"}
                        onValueChange={async (v) => {
                          try { await updProfile({ data: { user_id: u.id, team: v === "__none__" ? null : v } }); invalidate(); }
                          catch (e: any) { toast.error(e.message); }
                        }}
                      >
                        <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.code}>{t.code}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <LoginIdCell
                        value={u.login_id}
                        onSave={async (v) => {
                          await updLogin({ data: { user_id: u.id, login_id: v } });
                          invalidate();
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={u.user_type} onValueChange={async (v) => {
                        try { await updProfile({ data: { user_id: u.id, user_type: v as any } }); toast.success("업데이트됨"); invalidate(); }
                        catch (e: any) { toast.error(e.message); }
                      }}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{USER_TYPES.map((t) => <SelectItem key={t} value={t}>{USER_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <LinkedMasterCell user={u} onSaved={invalidate} updProfile={updProfile} />
                    </TableCell>
                    <TableCell>
                      <Select value={u.roles?.[0] ?? "guest"} onValueChange={async (v) => {
                        try { await updRole({ data: { user_id: u.id, role: v as any } }); toast.success("역할 변경됨"); invalidate(); }
                        catch (e: any) { toast.error(e.message); }
                      }}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={u.is_active} onCheckedChange={async (v) => {
                          try { await updProfile({ data: { user_id: u.id, is_active: v } }); invalidate(); }
                          catch (e: any) { toast.error(e.message); }
                        }} />
                        {u.must_change_password && <Badge variant="outline" className="text-[10px]">PW 변경필요</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <ResetPasswordButton onReset={async (pw) => {
                        try { await resetPw({ data: { user_id: u.id, temp_password: pw } }); toast.success("임시 PW 재발급됨"); invalidate(); }
                        catch (e: any) { toast.error(e.message); }
                      }} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
                            <AlertDialogDescription>{u.login_id} 계정을 완전히 삭제합니다. 되돌릴 수 없습니다.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction onClick={async () => {
                              try { await del({ data: { user_id: u.id } }); toast.success("삭제됨"); invalidate(); }
                              catch (e: any) { toast.error(e.message); }
                            }}>삭제</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{value || <span className="text-muted-foreground">—</span>}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setV(value ?? ""); setEditing(true); }}>
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value)} className="h-7 w-32" autoFocus />
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => {
        try { await onSave(v.trim()); setEditing(false); } catch (e: any) { toast.error(e.message); }
      }}><Check className="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(false)}>
        <XIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

function LoginIdCell({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{value}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setV(value ?? ""); setEditing(true); }}>
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value.toLowerCase())} className="h-7 w-32 font-mono" autoFocus />
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => {
        const clean = v.trim().toLowerCase();
        if (!/^[a-z0-9._-]+$/.test(clean)) { toast.error("영문 소문자·숫자·. _ - 만 사용"); return; }
        try { await onSave(clean); setEditing(false); toast.success("Login ID 변경됨"); } catch (e: any) { toast.error(e.message); }
      }}><Check className="h-3 w-3" /></Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(false)}>
        <XIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

function LinkedMasterCell({ user, onSaved, updProfile }: { user: any; onSaved: () => void; updProfile: any }) {
  const sub = useMasterList("subcontractor");
  const subsub = useMasterList("subsub");
  const pic = useMasterList("hdec_pic");
  const eng = useMasterList("hdec_eng");

  const save = async (field: string, v: string) => {
    try {
      await updProfile({ data: { user_id: user.id, [field]: v === "__none__" ? null : v } });
      onSaved();
    } catch (e: any) { toast.error(e.message); }
  };

  const renderSelect = (
    label: string,
    field: string,
    list: { data?: any[] } | null,
  ) => (
    <div className="flex items-center gap-1">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <Select value={user[field] ?? "__none__"} onValueChange={(v) => save(field, v)}>
        <SelectTrigger className="h-7 w-40"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {(list?.data ?? []).filter((m: any) => m.is_active).map((m: any) => (
            <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const showSub = user.user_type === "subcontractor";
  const showSubSub = user.user_type === "subsub";

  return (
    <div className="flex flex-col gap-1">
      {renderSelect("HDEC PIC", "hdec_pic_name", pic)}
      {renderSelect("HDEC Eng", "hdec_eng_name", eng)}
      {showSub && renderSelect("Sub", "subcontractor_name", sub)}
      {showSubSub && renderSelect("Sub-Sub", "subsub_name", subsub)}
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
          <DialogDescription>
            기본값은 <code className="font-mono">{DEFAULT_PASSWORD}</code> 입니다. 다음 로그인 시 변경이 강제됩니다.
            <br />{PASSWORD_HINT}
          </DialogDescription>
        </DialogHeader>
        <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="임시 비밀번호" />
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

function NewUserDialog({ onCreated }: { onCreated: () => void }) {
  const create = useServerFn(createAppUser);
  const teams = useTeamOptions();
  const [open, setOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userType, setUserType] = useState<UserType>("hdec_pic");
  const [role, setRole] = useState<AppRole>("user");
  const [tempPw, setTempPw] = useState(DEFAULT_PASSWORD);
  const [team, setTeam] = useState<string>("__none__");
  const [subName, setSubName] = useState<string>("");
  const [subsubName, setSubsubName] = useState<string>("");
  const subList = useMasterList("subcontractor");
  const subsubList = useMasterList("subsub");

  const submit = async () => {
    const cleanId = loginId.trim().toLowerCase();
    if (!cleanId || !displayName) { toast.error("필수 항목을 채우세요."); return; }
    if (!PASSWORD_REGEX.test(tempPw)) { toast.error(PASSWORD_HINT); return; }
    if (!/^[a-z0-9._-]+$/.test(cleanId)) {
      toast.error("Login ID는 영문 소문자, 숫자, . _ - 만 사용 가능"); return;
    }
    try {
      await create({
        data: {
          login_id: cleanId,
          display_name: displayName.trim(),
          name: displayName.trim(),
          user_type: userType,
          role,
          temp_password: tempPw,
          team: team === "__none__" ? null : team,
          subcontractor_name: userType === "subcontractor" ? (subName || null) : null,
          subsub_name: userType === "subsub" ? (subsubName || null) : null,
          hdec_pic_name: (userType === "hdec" || userType === "hdec_pic") ? (displayName.trim() || null) : null,
          hdec_eng_name: (userType === "pm_pd" || userType === "hdec_eng") ? (displayName.trim() || null) : null,
        },
      });
      toast.success("계정이 생성되었습니다", { description: `초기 비밀번호: ${tempPw}` });
      setOpen(false);
      setLoginId(""); setDisplayName(""); setTempPw(DEFAULT_PASSWORD);
      setSubName(""); setSubsubName(""); setTeam("__none__");
      onCreated();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus className="mr-1 h-4 w-4" />신규 계정</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>신규 계정</DialogTitle>
          <DialogDescription>
            Login ID는 영문 소문자·숫자·<code>. _ -</code>만 사용. 초기 비밀번호 기본값은{" "}
            <code className="font-mono">{DEFAULT_PASSWORD}</code>이며 첫 로그인 시 변경이 강제됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Login ID</Label>
              <Input value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())} placeholder="예: hong.gd" />
            </div>
            <div><Label>이름</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>User Type</Label>
              <Select value={userType} onValueChange={(v) => setUserType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hdec_pic">HDEC PIC</SelectItem>
                  <SelectItem value="hdec_eng">HDEC ENG</SelectItem>
                  <SelectItem value="hdec">HDEC (Legacy PIC)</SelectItem>
                  <SelectItem value="pm_pd">PM/PD (Legacy ENG)</SelectItem>
                  <SelectItem value="subcontractor">{USER_TYPE_LABELS["subcontractor"]}</SelectItem>
                  <SelectItem value="subsub">{USER_TYPE_LABELS["subsub"]}</SelectItem>
                  <SelectItem value="admin">{USER_TYPE_LABELS["admin"]}</SelectItem>
                  <SelectItem value="guest">{USER_TYPE_LABELS["guest"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Team</Label>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {(teams.data ?? []).map((t) => <SelectItem key={t.id} value={t.code}>{t.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {userType === "subcontractor" && (
            <div>
              <Label>Subcontractor</Label>
              <Select value={subName} onValueChange={setSubName}>
                <SelectTrigger><SelectValue placeholder="협력사 선택" /></SelectTrigger>
                <SelectContent>
                  {(subList.data ?? []).filter((m: any) => m.is_active).map((m: any) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {userType === "subsub" && (
            <div>
              <Label>Sub-Sub</Label>
              <Select value={subsubName} onValueChange={setSubsubName}>
                <SelectTrigger><SelectValue placeholder="Sub-Sub 선택" /></SelectTrigger>
                <SelectContent>
                  {(subsubList.data ?? []).filter((m: any) => m.is_active).map((m: any) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(userType === "hdec" || userType === "pm_pd" || userType === "hdec_pic" || userType === "hdec_eng") && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              {(userType === "hdec" || userType === "hdec_pic") ? "HDEC PIC" : "HDEC ENG"} 명단에는 위 <b>이름</b> 필드 값이 자동으로 등록됩니다.
            </div>
          )}
          <div>
            <Label>임시 비밀번호</Label>
            <Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{PASSWORD_HINT}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={submit}>생성</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
