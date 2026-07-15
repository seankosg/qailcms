import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Team = "MECH" | "ELEC" | "ARCH";

interface HeaderMapping {
  id: string;
  team: Team;
  source_header: string;
  target_field: string;
  round_index: number | null;
  stage: string | null;
  plan_or_actual: string | null;
  active: boolean;
  updated_at: string;
}

interface FieldConfig {
  id: string;
  field_key: string;
  label: string;
  group: string | null;
  data_type: string;
  editable: boolean;
  visible: boolean;
  sort_order: number;
}

export function AbdSettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">ABD Settings</h1>
        <p className="text-xs text-muted-foreground">헤더 매핑과 필드 설정을 관리합니다. 관리자만 수정할 수 있습니다.</p>
      </div>
      <Tabs defaultValue="mappings">
        <TabsList>
          <TabsTrigger value="mappings">Header Mappings</TabsTrigger>
          <TabsTrigger value="fields">Field Config</TabsTrigger>
        </TabsList>
        <TabsContent value="mappings" className="mt-4"><HeaderMappingsTable /></TabsContent>
        <TabsContent value="fields" className="mt-4"><FieldConfigTable /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Header Mappings ────────────────────────────────────────────────────────
function HeaderMappingsTable() {
  const [rows, setRows] = useState<HeaderMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState<"all" | Team>("all");
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("abd_header_mappings")
      .select("*")
      .order("team", { ascending: true })
      .order("source_header", { ascending: true });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (teamFilter !== "all" && r.team !== teamFilter) return false;
      if (!s) return true;
      return r.source_header.toLowerCase().includes(s) || r.target_field.toLowerCase().includes(s);
    });
  }, [rows, search, teamFilter]);

  const toggleActive = async (r: HeaderMapping, active: boolean) => {
    const { error } = await (supabase as any).from("abd_header_mappings").update({ active }).eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); return; }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, active } : x)));
  };
  const remove = async (r: HeaderMapping) => {
    if (!confirm(`매핑 삭제: ${r.source_header} → ${r.target_field}?`)) return;
    const { error } = await (supabase as any).from("abd_header_mappings").delete().eq("id", r.id);
    if (error) { toast.error("삭제 실패", { description: error.message }); return; }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm">Header Mappings ({rows.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v as any)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                <SelectItem value="MECH">MECH</SelectItem>
                <SelectItem value="ELEC">ELEC</SelectItem>
                <SelectItem value="ARCH">ARCH</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 text-xs" />
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Team</TableHead>
                <TableHead className="text-xs">Source Header</TableHead>
                <TableHead className="text-xs">Target Field</TableHead>
                <TableHead className="text-xs">Round</TableHead>
                <TableHead className="text-xs">Stage</TableHead>
                <TableHead className="text-xs">Plan/Actual</TableHead>
                <TableHead className="text-xs">Active</TableHead>
                <TableHead className="text-xs w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">매핑이 없습니다.</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="outline" className="text-[10px] uppercase">{r.team}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.source_header}</TableCell>
                  <TableCell className="text-xs font-mono text-primary">{r.target_field}</TableCell>
                  <TableCell className="text-xs">{r.round_index ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.stage ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.plan_or_actual ?? "—"}</TableCell>
                  <TableCell><Switch checked={r.active} onCheckedChange={(v) => toggleActive(r, v)} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <AddMappingDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
    </Card>
  );
}

function AddMappingDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const [team, setTeam] = useState<Team>("MECH");
  const [sourceHeader, setSourceHeader] = useState("");
  const [targetField, setTargetField] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!sourceHeader.trim() || !targetField.trim()) { toast.error("Source Header와 Target Field를 입력하세요"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("abd_header_mappings").insert({
      team, source_header: sourceHeader.trim(), target_field: targetField.trim(), active: true,
    });
    setSaving(false);
    if (error) { toast.error("추가 실패", { description: error.message }); return; }
    toast.success("매핑 추가됨");
    setSourceHeader(""); setTargetField("");
    onOpenChange(false);
    onAdded();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Header Mapping 추가</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Team</Label>
            <Select value={team} onValueChange={(v) => setTeam(v as Team)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MECH">MECH</SelectItem>
                <SelectItem value="ELEC">ELEC</SelectItem>
                <SelectItem value="ARCH">ARCH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Source Header (엑셀 원본)</Label><Input value={sourceHeader} onChange={(e) => setSourceHeader(e.target.value)} placeholder="예: DOC. TITLE" /></div>
          <div><Label>Target Field (정규 필드명)</Label><Input value={targetField} onChange={(e) => setTargetField(e.target.value)} placeholder="예: document_title" className="font-mono" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Field Config ───────────────────────────────────────────────────────────
function FieldConfigTable() {
  const [rows, setRows] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("abd_field_config").select("*").order("sort_order", { ascending: true });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.field_key.toLowerCase().includes(s) || r.label.toLowerCase().includes(s));
  }, [rows, search]);

  const patch = async (r: FieldConfig, changes: Partial<FieldConfig>) => {
    const { error } = await (supabase as any).from("abd_field_config").update(changes).eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); return; }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...changes } : x)));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm">Field Config ({rows.length})</CardTitle>
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 text-xs" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-16">#</TableHead>
                <TableHead className="text-xs">Field Key</TableHead>
                <TableHead className="text-xs">Label</TableHead>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Visible</TableHead>
                <TableHead className="text-xs">Editable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">필드 설정이 없습니다.</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs tabular-nums">{r.sort_order}</TableCell>
                  <TableCell className="text-xs font-mono">{r.field_key}</TableCell>
                  <TableCell className="text-xs">
                    <Input defaultValue={r.label} className="h-7 text-xs"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.label) void patch(r, { label: v }); }} />
                  </TableCell>
                  <TableCell className="text-xs">{r.group ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.data_type}</TableCell>
                  <TableCell><Switch checked={r.visible} onCheckedChange={(v) => patch(r, { visible: v })} /></TableCell>
                  <TableCell><Switch checked={r.editable} onCheckedChange={(v) => patch(r, { editable: v })} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}