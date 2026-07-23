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
  useAbdHeaderMappings,
  ABD_HEADER_MAPPING_QK,
  type AbdHeaderMappingRow,
  type AbdTeam,
} from "@/hooks/useAbdHeaderMappings";
import { useAbdFieldConfig } from "@/hooks/useAbdFieldConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { EditableSourceHeaderCell } from "@/components/admin/EditableSourceHeaderCell";
import { EditableTargetFieldCell } from "@/components/admin/EditableTargetFieldCell";
import { normalizeHeader } from "@/lib/admin/header-mapping-validation";

const TEAMS: AbdTeam[] = ["MECH", "ELEC", "ARCH"];

export function AbdHeaderMappingTable() {
  const { data: rows = [], isLoading, refetch } = useAbdHeaderMappings();
  const { data: fieldConfig = [] } = useAbdFieldConfig();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState<"all" | AbdTeam>("all");
  const [testHeader, setTestHeader] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newTeam, setNewTeam] = useState<AbdTeam>("MECH");
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState<string>("");
  const [newRound, setNewRound] = useState<string>("");
  const [newStage, setNewStage] = useState<string>("");
  const [newPlanActual, setNewPlanActual] = useState<string>("");

  // field_config를 defect 훅 인터페이스와 유사한 형태로 매핑(field_name/display_name)
  const fields = useMemo(
    () => fieldConfig.map((f) => ({ field_name: f.field_key, display_name: f.label })),
    [fieldConfig],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (teamFilter !== "all" && r.team !== teamFilter) return false;
      if (!s) return true;
      return r.source_header.toLowerCase().includes(s) || r.target_field.toLowerCase().includes(s);
    });
  }, [rows, search, teamFilter]);

  const testResult = useMemo(() => {
    if (!testHeader.trim()) return null;
    const norm = normalizeHeader(testHeader);
    const scope = teamFilter === "all" ? rows : rows.filter((r) => r.team === teamFilter);
    const hit = scope.find((r) => r.is_active && normalizeHeader(r.source_header) === norm);
    return { norm, target: hit?.target_field ?? null, team: hit?.team ?? null };
  }, [testHeader, rows, teamFilter]);

  const activeTargetFields = useMemo(
    () => new Set(fields.map((f) => f.field_name)),
    [fields],
  );

  const canEdit = !!me?.isAdmin;

  const invalidate = async () => {
    qc.invalidateQueries({ queryKey: ABD_HEADER_MAPPING_QK });
    await refetch();
  };

  const saveSourceHeader = async (r: AbdHeaderMappingRow, trimmed: string) => {
    const { error } = await (supabase as any)
      .from("abd_header_mappings")
      .update({ source_header: trimmed, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); throw error; }
    await invalidate();
  };

  const saveTargetField = async (r: AbdHeaderMappingRow, next: string) => {
    const { error } = await (supabase as any)
      .from("abd_header_mappings")
      .update({ target_field: next, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); throw error; }
    await invalidate();
  };

  const toggleActive = async (r: AbdHeaderMappingRow) => {
    const next = !r.is_active;
    const { error } = await (supabase as any)
      .from("abd_header_mappings")
      .update({ is_active: next, active: next, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) return toast.error("실패", { description: error.message });
    await invalidate();
  };

  const removeRow = async (r: AbdHeaderMappingRow) => {
    if (!canEdit) return;
    const msg = r.is_custom
      ? `매핑 "${r.source_header}" → ${r.target_field} 을(를) 삭제하시겠습니까?`
      : `System 매핑 "${r.source_header}" → ${r.target_field} 을(를) 삭제하시겠습니까?\n\n※ 시드 재배포 시 되돌아갈 수 있습니다.`;
    if (!confirm(msg)) return;
    const { error } = await (supabase as any).from("abd_header_mappings").delete().eq("id", r.id);
    if (error) return toast.error("삭제 실패", { description: error.message });
    toast.success("삭제되었습니다");
    await invalidate();
  };

  const submitNew = async () => {
    if (!newSource.trim() || !newTarget) {
      return toast.error("필수 입력", { description: "원본 헤더와 대상 필드를 입력하세요." });
    }
    const roundNum = newRound.trim() ? Number(newRound.trim()) : null;
    if (newRound.trim() && (roundNum === null || Number.isNaN(roundNum))) {
      return toast.error("Round는 숫자여야 합니다");
    }
    const { error } = await (supabase as any).from("abd_header_mappings").insert({
      team: newTeam,
      source_header: newSource.trim(),
      target_field: newTarget,
      round_index: roundNum,
      stage: newStage.trim() || null,
      plan_or_actual: newPlanActual.trim() || null,
      is_custom: true,
      is_active: true,
      active: true,
      updated_by: me?.id ?? null,
    });
    if (error) return toast.error("추가 실패", { description: error.message });
    toast.success("매핑이 추가되었습니다");
    setAddOpen(false);
    setNewSource(""); setNewTarget(""); setNewRound(""); setNewStage(""); setNewPlanActual("");
    await invalidate();
  };

  // EditableSourceHeaderCell/EditableTargetFieldCell에 넘길 HeaderMappingLike 어댑터
  const rowsForCell = useMemo(
    () => rows.map((r) => ({
      id: r.id,
      source_header: r.source_header,
      target_field: r.target_field,
      is_active: r.is_active,
    })),
    [rows],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Header Mapping — ABD Excel Import 별칭</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            As Built Drawing 업로드용 Excel 원본 헤더를 팀별 시스템 필드에 연결합니다. 시스템 매핑은 잠금 표시됩니다.
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
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">norm: {testResult.norm}</Badge>
                {testResult.target ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    {testResult.team ? `[${testResult.team}] ` : ""}→ {testResult.target}
                  </Badge>
                ) : (
                  <Badge variant="destructive">매칭 없음{teamFilter !== "all" ? ` (${teamFilter} 스코프)` : ""}</Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v as any)}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {TEAMS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
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
                <TableHead className="w-[90px]">Team</TableHead>
                <TableHead>Source Header (Excel)</TableHead>
                <TableHead className="w-[220px]">Target Field</TableHead>
                <TableHead className="w-[70px]">Round</TableHead>
                <TableHead className="w-[100px]">Stage</TableHead>
                <TableHead className="w-[110px]">Plan/Actual</TableHead>
                <TableHead className="w-[90px]">Type</TableHead>
                <TableHead className="w-[80px] text-center">Active</TableHead>
                <TableHead className="w-[70px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">매핑이 없습니다.</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <TableCell><Badge variant="outline" className="text-[10px] uppercase">{r.team}</Badge></TableCell>
                  <TableCell className="text-sm">
                    <EditableSourceHeaderCell
                      row={{ ...rowsForCell.find((x) => x.id === r.id)!, is_custom: r.is_custom }}
                      rows={rowsForCell}
                      activeTargetFields={activeTargetFields}
                      onSave={(v) => saveSourceHeader(r, v)}
                      canEdit={canEdit}
                    />
                  </TableCell>
                  <TableCell className="text-xs">
                    <EditableTargetFieldCell
                      row={rowsForCell.find((x) => x.id === r.id)!}
                      rows={rowsForCell}
                      fields={fields}
                      activeTargetFields={activeTargetFields}
                      onSave={(v) => saveTargetField(r, v)}
                      canEdit={canEdit}
                    />
                  </TableCell>
                  <TableCell className="text-xs">{r.round_index ?? "—"}</TableCell>
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
              ))}
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
              <Label className="text-xs">Team</Label>
              <Select value={newTeam} onValueChange={(v) => setNewTeam(v as AbdTeam)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEAMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source Header (Excel 원본 문자열)</Label>
              <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="예: DOC. TITLE" />
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
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Round (선택)</Label>
                <Input value={newRound} onChange={(e) => setNewRound(e.target.value)} placeholder="1" inputMode="numeric" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Stage (선택)</Label>
                <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="draft / submission / response" />
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