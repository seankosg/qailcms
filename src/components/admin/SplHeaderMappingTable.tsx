import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock, Plus, Trash2 } from "lucide-react";
import {
  useSplHeaderMappings,
  SPL_HEADER_MAPPING_QK,
  type SplHeaderMappingRow,
  type SplForm,
} from "@/hooks/useSplHeaderMappings";
import { useSplFieldConfig } from "@/hooks/useSplFieldConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { EditableSourceHeaderCell } from "@/components/admin/EditableSourceHeaderCell";
import { EditableTargetFieldCell } from "@/components/admin/EditableTargetFieldCell";
import { normalizeHeader } from "@/lib/admin/header-mapping-validation";

const FORMS: SplForm[] = ["HDEC", "VIEW", "ACONEX"];
const FORM_LABEL: Record<SplForm, string> = {
  HDEC: "HDEC (4행 헤더 왕복 양식)",
  VIEW: "View (화면 표시 그대로)",
  ACONEX: "Aconex (시딩본 정본)",
};

/** 중복 검증 스코프 키 — 같은 양식 + 같은 Plan/Actual · 시작/종료 슬롯 안에서만 헤더가 유일해야 한다. */
const slotKey = (r: SplHeaderMappingRow) => `${r.form}|${r.stage ?? ""}|${r.plan_or_actual ?? ""}`;

export function SplHeaderMappingTable() {
  const { data: rows = [], isLoading, refetch } = useSplHeaderMappings();
  const { data: fieldConfig = [] } = useSplFieldConfig();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState<"all" | SplForm>("all");
  const [testHeader, setTestHeader] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState<SplForm>("HDEC");
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState<string>("");
  const [newStage, setNewStage] = useState<string>("");
  const [newPlanActual, setNewPlanActual] = useState<string>("");

  const fields = useMemo(
    () => fieldConfig.map((f) => ({ field_name: f.field_key, display_name: f.label })),
    [fieldConfig],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (formFilter !== "all" && r.form !== formFilter) return false;
      if (!s) return true;
      return r.source_header.toLowerCase().includes(s) || r.target_field.toLowerCase().includes(s);
    });
  }, [rows, search, formFilter]);

  const testResult = useMemo(() => {
    if (!testHeader.trim()) return null;
    const norm = normalizeHeader(testHeader);
    const scope = formFilter === "all" ? rows : rows.filter((r) => r.form === formFilter);
    const hits = scope.filter((r) => r.is_active && normalizeHeader(r.source_header) === norm);
    return { norm, hits };
  }, [testHeader, rows, formFilter]);

  const activeTargetFields = useMemo(() => new Set(fields.map((f) => f.field_name)), [fields]);

  const canEdit = !!me?.isAdmin;

  const invalidate = async () => {
    qc.invalidateQueries({ queryKey: SPL_HEADER_MAPPING_QK });
    await refetch();
  };

  const saveSourceHeader = async (r: SplHeaderMappingRow, trimmed: string) => {
    const { error } = await (supabase as any)
      .from("spl_header_mappings")
      .update({ source_header: trimmed, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); throw error; }
    await invalidate();
  };

  const saveTargetField = async (r: SplHeaderMappingRow, next: string) => {
    const { error } = await (supabase as any)
      .from("spl_header_mappings")
      .update({ target_field: next, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); throw error; }
    await invalidate();
  };

  const toggleActive = async (r: SplHeaderMappingRow) => {
    const { error } = await (supabase as any)
      .from("spl_header_mappings")
      .update({ is_active: !r.is_active, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) return toast.error("실패", { description: error.message });
    await invalidate();
  };

  const removeRow = async (r: SplHeaderMappingRow) => {
    if (!canEdit) return;
    const msg = r.is_custom
      ? `매핑 "${r.source_header}" → ${r.target_field} 을(를) 삭제하시겠습니까?`
      : `System 매핑 "${r.source_header}" → ${r.target_field} 을(를) 삭제하시겠습니까?\n\n※ 시드 재배포 시 되돌아갈 수 있습니다.`;
    if (!confirm(msg)) return;
    const { error } = await (supabase as any).from("spl_header_mappings").delete().eq("id", r.id);
    if (error) return toast.error("삭제 실패", { description: error.message });
    toast.success("삭제되었습니다");
    await invalidate();
  };

  const submitNew = async () => {
    if (!newSource.trim() || !newTarget) {
      return toast.error("필수 입력", { description: "원본 헤더와 대상 필드를 입력하세요." });
    }
    const { error } = await (supabase as any).from("spl_header_mappings").insert({
      form: newForm,
      source_header: newSource.trim(),
      target_field: newTarget,
      stage: newStage.trim() || null,
      plan_or_actual: newPlanActual.trim() || null,
      is_custom: true,
      is_active: true,
      updated_by: me?.id ?? null,
    });
    if (error) return toast.error("추가 실패", { description: error.message });
    toast.success("매핑이 추가되었습니다");
    setAddOpen(false);
    setNewSource(""); setNewTarget(""); setNewStage(""); setNewPlanActual("");
    await invalidate();
  };

  const rowsForCell = useMemo(
    () => rows.map((r) => ({
      id: r.id,
      source_header: r.source_header,
      target_field: r.target_field,
      is_active: r.is_active,
      slot: slotKey(r),
    })),
    [rows],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Header Mapping — SPL Excel Import 별칭</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Spare Parts List 업로드용 Excel 원본 헤더를 양식별 시스템 필드에 연결합니다. 시스템 매핑은 잠금 표시됩니다.
            단계 필드는 <span className="font-mono">stage:&lt;STAGE_CODE&gt;|ps/as/pf/af/fv</span> 형식입니다.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Mapping
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded border bg-muted/30 p-3 space-y-2">
          <Label className="text-xs font-semibold">Mapping Test</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="원본 Excel 헤더 문자열 입력…"
              value={testHeader}
              onChange={(e) => setTestHeader(e.target.value)}
              className="h-8 max-w-md"
            />
            {testResult && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">norm: {testResult.norm}</Badge>
                {testResult.hits.length > 0 ? (
                  testResult.hits.map((h) => (
                    <Badge key={h.id} className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      [{h.form}] {h.plan_or_actual ? `${h.plan_or_actual}${h.stage ? `/${h.stage}` : ""} ` : ""}→ {h.target_field}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="destructive">매칭 없음{formFilter !== "all" ? ` (${formFilter} 스코프)` : ""}</Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={formFilter} onValueChange={(v) => setFormFilter(v as any)}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Forms</SelectItem>
              {FORMS.map((t) => (
                <SelectItem key={t} value={t}>{FORM_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="원본 헤더 또는 대상 필드 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md h-8"
          />
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} / {rows.length}</span>
        </div>

        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Form</TableHead>
                <TableHead>Source Header (Excel)</TableHead>
                <TableHead className="w-[260px]">Target Field</TableHead>
                <TableHead className="w-[100px]">Stage</TableHead>
                <TableHead className="w-[110px]">Plan/Actual</TableHead>
                <TableHead className="w-[90px]">Type</TableHead>
                <TableHead className="w-[80px] text-center">Active</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">매핑이 없습니다.</TableCell></TableRow>
              )}
              {filtered.map((r) => {
                const slot = slotKey(r);
                const scoped = rowsForCell.filter((x) => x.slot === slot);
                const self = rowsForCell.find((x) => x.id === r.id)!;
                return (
                  <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{r.form}</Badge></TableCell>
                    <TableCell className="text-sm">
                      <EditableSourceHeaderCell
                        row={{ ...self, is_custom: r.is_custom }}
                        rows={scoped}
                        activeTargetFields={activeTargetFields}
                        onSave={(v) => saveSourceHeader(r, v)}
                        canEdit={canEdit}
                      />
                      {r.note && <div className="text-[10px] text-muted-foreground mt-0.5">{r.note}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <EditableTargetFieldCell
                        row={self}
                        rows={scoped}
                        fields={fields}
                        activeTargetFields={activeTargetFields}
                        onSave={(v) => saveTargetField(r, v)}
                        canEdit={canEdit}
                      />
                    </TableCell>
                    <TableCell className="text-xs">{r.stage ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.plan_or_actual ?? "—"}</TableCell>
                    <TableCell>
                      {r.is_custom ? (
                        <Badge variant="secondary">Custom</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />System</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} disabled={!canEdit} />
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(r)}
                          title={r.is_custom ? "삭제" : "System 매핑 삭제 (주의)"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Header Mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Form</Label>
              <Select value={newForm} onValueChange={(v) => setNewForm(v as SplForm)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMS.map((t) => <SelectItem key={t} value={t}>{FORM_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source Header (Excel 원본 문자열)</Label>
              <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="예: Submission / D-SB-PS" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Target Field</Label>
              <Select value={newTarget} onValueChange={setNewTarget}>
                <SelectTrigger><SelectValue placeholder="대상 필드 선택" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {fields.map((f) => (
                    <SelectItem key={f.field_name} value={f.field_name}>
                      <span className="font-mono text-xs mr-2">{f.field_name}</span>
                      <span className="text-muted-foreground">— {f.display_name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Stage (선택)</Label>
                <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="start / finish / flag" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Plan/Actual</Label>
                <Input value={newPlanActual} onChange={(e) => setNewPlanActual(e.target.value)} placeholder="plan / actual" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
            <Button onClick={submitNew}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
