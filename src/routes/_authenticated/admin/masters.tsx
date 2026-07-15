import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  addMasterName,
  toggleMasterActive,
  deleteMasterName,
  updateMasterFields,
} from "@/lib/admin/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/masters")({
  head: () => ({ meta: [{ title: "마스터 관리 — QAIL CMS" }] }),
  component: MastersAdminPage,
});

type MasterKind = "subcontractor" | "subsub" | "hdec_pic" | "hdec_eng" | "team";

function MastersAdminPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">마스터 관리</h1>
      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="subcontractor">Subcontractor</TabsTrigger>
          <TabsTrigger value="subsub">Sub-Sub</TabsTrigger>
          <TabsTrigger value="hdec_pic">HDEC PIC</TabsTrigger>
          <TabsTrigger value="hdec_eng">HDEC Eng</TabsTrigger>
        </TabsList>
        <TabsContent value="team"><TeamMasterTab /></TabsContent>
        <TabsContent value="subcontractor"><SubcontractorTab kind="subcontractor" /></TabsContent>
        <TabsContent value="subsub"><SubcontractorTab kind="subsub" /></TabsContent>
        <TabsContent value="hdec_pic"><SimpleMasterTab kind="hdec_pic" title="HDEC PIC" /></TabsContent>
        <TabsContent value="hdec_eng"><SimpleMasterTab kind="hdec_eng" title="HDEC Eng" /></TabsContent>
      </Tabs>
    </div>
  );
}

function useMasterList(kind: MasterKind) {
  return useQuery({
    queryKey: ["master", kind],
    queryFn: async () => {
      if (kind === "team") {
        const { data, error } = await (supabase as any)
          .from("team_master")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("code");
        if (error) throw error;
        return data ?? [];
      }
      if (kind === "hdec_pic") {
        const { data, error } = await supabase.from("hdec_pic_master").select("*").order("name");
        if (error) throw error;
        return data ?? [];
      }
      if (kind === "hdec_eng") {
        const { data, error } = await (supabase as any).from("hdec_eng_master").select("*").order("name");
        if (error) throw error;
        return data ?? [];
      }
      // subcontractor / subsub
      const type = kind === "subsub" ? "subsub" : "sub";
      const { data, error } = await (supabase as any)
        .from("subcontractor_master")
        .select("*")
        .eq("type", type)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useSubParentOptions() {
  return useQuery({
    queryKey: ["master", "subcontractor", "parents"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("subcontractor_master")
        .select("id,name,is_active")
        .eq("type", "sub")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; is_active: boolean }[];
    },
  });
}

/** 단순 이름-only 마스터 (HDEC PIC / HDEC Eng) */
function SimpleMasterTab({ kind, title }: { kind: "hdec_pic" | "hdec_eng"; title: string }) {
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
            <TableHeader><TableRow><TableHead>이름</TableHead><TableHead className="w-24">활성</TableHead><TableHead className="w-20 text-right">삭제</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Switch checked={m.is_active} onCheckedChange={async (v) => {
                      try { await toggle({ data: { kind, id: m.id, is_active: v } }); invalidate(); }
                      catch (e: any) { toast.error(e.message); }
                    }} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={async () => {
                      if (!confirm(`${m.name} 을(를) 삭제하시겠습니까?`)) return;
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

function SubcontractorTab({ kind }: { kind: "subcontractor" | "subsub" }) {
  const title = kind === "subsub" ? "Sub-Sub" : "Subcontractor";
  const { data, isLoading } = useMasterList(kind);
  const parents = useSubParentOptions();
  const qc = useQueryClient();
  const add = useServerFn(addMasterName);
  const toggle = useServerFn(toggleMasterActive);
  const del = useServerFn(deleteMasterName);
  const upd = useServerFn(updateMasterFields);
  const [name, setName] = useState("");
  const [ownerCode, setOwnerCode] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["master", kind] });
    qc.invalidateQueries({ queryKey: ["master", "subcontractor", "parents"] });
  };
  const parentNameById = useMemo(() => {
    const m = new Map<string, string>();
    (parents.data ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [parents.data]);

  return (
    <Card>
      <CardHeader><CardTitle>{title} 마스터</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label className="text-xs text-muted-foreground">이름</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-36">
            <label className="text-xs text-muted-foreground">Owner Code</label>
            <Input value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)} placeholder="선택" />
          </div>
          {kind === "subsub" && (
            <div className="w-56">
              <label className="text-xs text-muted-foreground">상위 협력사</label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  {(parents.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={async () => {
            if (!name.trim()) return;
            if (kind === "subsub" && !parentId) { toast.error("상위 협력사를 선택하세요."); return; }
            try {
              await add({ data: {
                kind, name: name.trim(),
                owner_code: ownerCode.trim() || null,
                parent_id: kind === "subsub" ? parentId : null,
              } });
              setName(""); setOwnerCode(""); setParentId("");
              invalidate();
            } catch (e: any) { toast.error(e.message); }
          }}><Plus className="mr-1 h-4 w-4" />추가</Button>
        </div>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                {kind === "subsub" && <TableHead>상위</TableHead>}
                <TableHead className="w-40">Owner Code</TableHead>
                <TableHead className="w-24">활성</TableHead>
                <TableHead className="w-20 text-right">삭제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{m.name}</TableCell>
                  {kind === "subsub" && (
                    <TableCell className="text-sm text-muted-foreground">
                      {parentNameById.get(m.parent_subcontractor_id ?? "") ?? "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <Input
                      defaultValue={m.owner_code ?? ""}
                      className="h-8"
                      onBlur={async (e) => {
                        const v = e.target.value.trim();
                        if ((m.owner_code ?? "") === v) return;
                        try { await upd({ data: { kind, id: m.id, owner_code: v || null } }); invalidate(); }
                        catch (err: any) { toast.error(err.message); }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={m.is_active} onCheckedChange={async (v) => {
                      try { await toggle({ data: { kind, id: m.id, is_active: v } }); invalidate(); }
                      catch (e: any) { toast.error(e.message); }
                    }} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={async () => {
                      if (!confirm(`${m.name} 을(를) 삭제하시겠습니까?`)) return;
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

function TeamMasterTab() {
  const { data, isLoading } = useMasterList("team");
  const qc = useQueryClient();
  const add = useServerFn(addMasterName);
  const toggle = useServerFn(toggleMasterActive);
  const del = useServerFn(deleteMasterName);
  const upd = useServerFn(updateMasterFields);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sort, setSort] = useState<string>("0");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["master", "team"] });
    qc.invalidateQueries({ queryKey: ["team-master", "active"] });
    qc.invalidateQueries({ queryKey: ["team-master", "all"] });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Team 마스터</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <label className="text-xs text-muted-foreground">Code (대문자)</label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="예: MECH" />
          </div>
          <div className="min-w-40 flex-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Code와 동일하게 두면 자동 채움" />
          </div>
          <div className="w-24">
            <label className="text-xs text-muted-foreground">Sort</label>
            <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </div>
          <Button onClick={async () => {
            const c = code.trim().toUpperCase();
            if (!c) { toast.error("Code를 입력하세요."); return; }
            try {
              await add({ data: {
                kind: "team",
                code: c,
                name: (name.trim() || c),
                sort_order: Number(sort) || 0,
              } });
              setCode(""); setName(""); setSort("0");
              invalidate();
            } catch (e: any) { toast.error(e.message); }
          }}><Plus className="mr-1 h-4 w-4" />추가</Button>
        </div>
        {isLoading ? <div className="text-sm text-muted-foreground">불러오는 중…</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-24">Sort</TableHead>
                <TableHead>별칭 (쉼표)</TableHead>
                <TableHead className="w-24">활성</TableHead>
                <TableHead className="w-20 text-right">삭제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono">{t.code}</TableCell>
                  <TableCell>
                    <Input
                      defaultValue={t.name}
                      className="h-8"
                      onBlur={async (e) => {
                        const v = e.target.value.trim().toUpperCase();
                        if (!v || v === t.name) return;
                        try { await upd({ data: { kind: "team", id: t.id, name: v } }); invalidate(); }
                        catch (err: any) { toast.error(err.message); }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      defaultValue={t.sort_order ?? 0}
                      className="h-8"
                      onBlur={async (e) => {
                        const v = Number(e.target.value) || 0;
                        if (v === (t.sort_order ?? 0)) return;
                        try { await upd({ data: { kind: "team", id: t.id, sort_order: v } }); invalidate(); }
                        catch (err: any) { toast.error(err.message); }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={(t.aliases ?? []).join(", ")}
                      className="h-8"
                      placeholder="예: 설비, MECHANICAL"
                      onBlur={async (e) => {
                        const raw = e.target.value;
                        const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
                        const prev = ((t.aliases ?? []) as string[]).join("|");
                        if (arr.join("|") === prev) return;
                        try {
                          await upd({ data: { kind: "team", id: t.id, code: t.code, aliases: arr } });
                          invalidate();
                        } catch (err: any) { toast.error(err.message); }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={t.is_active} onCheckedChange={async (v) => {
                      try { await toggle({ data: { kind: "team", id: t.id, is_active: v } }); invalidate(); }
                      catch (e: any) { toast.error(e.message); }
                    }} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={async () => {
                      if (!confirm(`${t.code} 팀을 삭제하시겠습니까?\n\n사용 중인 프로필/Raw 데이터가 있다면 실패할 수 있습니다.`)) return;
                      try { await del({ data: { kind: "team", id: t.id } }); invalidate(); }
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