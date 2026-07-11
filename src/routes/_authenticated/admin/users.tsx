import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listAppUsers, createAppUser, resetUserPassword, updateUserRole,
  updateUserProfileFields, deleteAppUser, addMasterName, toggleMasterActive, deleteMasterName,
  DEFAULT_INITIAL_PASSWORD,
} from "@/lib/admin/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Trash2, Plus, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersAdminPage,
});

const USER_TYPES = ["subcontractor", "hdec", "pm_pd", "admin"] as const;
const ROLES = ["guest", "user", "superuser", "admin"] as const;

function UsersAdminPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">사용자 관리</h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">사용자</TabsTrigger>
          <TabsTrigger value="subcontractor">협력사 마스터</TabsTrigger>
          <TabsTrigger value="hdec_pic">HDEC PIC 마스터</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="subcontractor"><MasterTab kind="subcontractor" title="협력사" /></TabsContent>
        <TabsContent value="hdec_pic"><MasterTab kind="hdec_pic" title="HDEC PIC" /></TabsContent>
      </Tabs>
    </div>
  );
}

function useMasterList(kind: "subcontractor" | "hdec_pic") {
  const table = kind === "subcontractor" ? "subcontractor_master" : "hdec_pic_master";
  return useQuery({
    queryKey: ["master", kind],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function UsersTab() {
  const list = useServerFn(listAppUsers);
  const resetPw = useServerFn(resetUserPassword);
  const updRole = useServerFn(updateUserRole);
  const updProfile = useServerFn(updateUserProfileFields);
  const del = useServerFn(deleteAppUser);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => list({}) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const rows = (data ?? []).filter((u: any) => {
    if (filterRole !== "all" && !(u.roles ?? []).includes(filterRole)) return false;
    if (filterType !== "all" && u.user_type !== filterType) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>사용자 목록</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-32"><SelectValue placeholder="역할" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 역할</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-36"><SelectValue placeholder="소속" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 소속</SelectItem>
              {USER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <NewUserDialog onCreated={invalidate} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Login ID</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>소속</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>협력사/PIC</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.login_id}</TableCell>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>
                      <Select value={u.user_type} onValueChange={async (v) => {
                        try { await updProfile({ data: { user_id: u.id, user_type: v as any } }); toast.success("업데이트됨"); invalidate(); }
                        catch (e: any) { toast.error(e.message); }
                      }}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{USER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={u.roles?.[0] ?? "guest"} onValueChange={async (v) => {
                        try { await updRole({ data: { user_id: u.id, role: v as any } }); toast.success("역할 변경됨"); invalidate(); }
                        catch (e: any) { toast.error(e.message); }
                      }}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.subcontractor_name || u.hdec_pic_name || "—"}</TableCell>
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

function ResetPasswordButton({ onReset }: { onReset: (pw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(DEFAULT_INITIAL_PASSWORD);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><KeyRound className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>임시 비밀번호 발급</DialogTitle>
          <DialogDescription>
            기본값은 <code className="font-mono">{DEFAULT_INITIAL_PASSWORD}</code> 입니다. 다음 로그인 시 변경이 강제됩니다.
          </DialogDescription>
        </DialogHeader>
        <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="임시 비밀번호 (8자 이상)" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={async () => {
            if (pw.length < 8) { toast.error("8자 이상"); return; }
            await onReset(pw); setOpen(false); setPw(DEFAULT_INITIAL_PASSWORD);
          }}>발급</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewUserDialog({ onCreated }: { onCreated: () => void }) {
  const create = useServerFn(createAppUser);
  const [open, setOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userType, setUserType] = useState<(typeof USER_TYPES)[number]>("hdec");
  const [role, setRole] = useState<(typeof ROLES)[number]>("user");
  const [tempPw, setTempPw] = useState(DEFAULT_INITIAL_PASSWORD);
  const [subName, setSubName] = useState<string>("");
  const [picName, setPicName] = useState<string>("");
  const subList = useMasterList("subcontractor");
  const picList = useMasterList("hdec_pic");

  const submit = async () => {
    const cleanId = loginId.trim().toLowerCase();
    if (!cleanId || !displayName || tempPw.length < 8) {
      toast.error("필수 항목을 채우고 임시 PW는 8자 이상"); return;
    }
    if (!/^[a-z0-9._-]+$/.test(cleanId)) {
      toast.error("Login ID는 영문 소문자, 숫자, . _ - 만 사용 가능"); return;
    }
    try {
      await create({
        data: {
          login_id: cleanId,
          display_name: displayName.trim(),
          user_type: userType,
          role,
          temp_password: tempPw,
          subcontractor_name: userType === "subcontractor" ? (subName || null) : null,
          hdec_pic_name: userType === "hdec" ? (picName || null) : null,
        },
      });
      toast.success("계정이 생성되었습니다", { description: `초기 비밀번호: ${tempPw}` });
      setOpen(false);
      setLoginId(""); setDisplayName(""); setTempPw(DEFAULT_INITIAL_PASSWORD); setSubName(""); setPicName("");
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
            <code className="font-mono">{DEFAULT_INITIAL_PASSWORD}</code>이며 첫 로그인 시 변경이 강제됩니다.
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
              <Label>소속</Label>
              <Select value={userType} onValueChange={(v) => setUserType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{USER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>역할</Label>
              <Select value={role} onValueChange={(v) => setRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {userType === "subcontractor" && (
            <div>
              <Label>협력사</Label>
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
          {userType === "hdec" && (
            <div>
              <Label>HDEC PIC</Label>
              <Select value={picName} onValueChange={setPicName}>
                <SelectTrigger><SelectValue placeholder="PIC 선택" /></SelectTrigger>
                <SelectContent>
                  {(picList.data ?? []).filter((m: any) => m.is_active).map((m: any) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>임시 비밀번호 (8자+)</Label>
            <Input value={tempPw} onChange={(e) => setTempPw(e.target.value)} />
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

function MasterTab({ kind, title }: { kind: "subcontractor" | "hdec_pic"; title: string }) {
  const { data, isLoading } = useMasterList(kind);
  const qc = useQueryClient();
  const add = useServerFn(addMasterName);
  const toggle = useServerFn(toggleMasterActive);
  const del = useServerFn(deleteMasterName);
  const [name, setName] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["master", kind] });

  return (
    <Card>
      <CardHeader><CardTitle>{title} 마스터</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${title} 이름`} />
          <Button onClick={async () => {
            if (!name.trim()) return;
            try { await add({ data: { kind, name: name.trim() } }); setName(""); invalidate(); }
            catch (e: any) { toast.error(e.message); }
          }}><Plus className="mr-1 h-4 w-4" />추가</Button>
        </div>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <Table>
            <TableHeader><TableRow><TableHead>이름</TableHead><TableHead>활성</TableHead><TableHead className="text-right">삭제</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell><Switch checked={m.is_active} onCheckedChange={async (v) => {
                    try { await toggle({ data: { kind, id: m.id, is_active: v } }); invalidate(); }
                    catch (e: any) { toast.error(e.message); }
                  }} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={async () => {
                      try { await del({ data: { kind, id: m.id } }); invalidate(); }
                      catch (e: any) { toast.error(e.message); }
                    }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}