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
  useDefectHeaderMappings,
  DEFECT_HEADER_MAPPING_QK,
  type DefectHeaderMappingRow,
} from "@/hooks/useDefectHeaderMappings";
import { useDefectFieldConfig } from "@/hooks/useDefectFieldConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { EditableSourceHeaderCell } from "@/components/admin/EditableSourceHeaderCell";
import { normalizeHeader } from "@/lib/admin/header-mapping-validation";

export function DefectHeaderMappingTable() {
  const { data: rows = [], isLoading, refetch } = useDefectHeaderMappings();
  const { data: fields = [] } = useDefectFieldConfig();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [testHeader, setTestHeader] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState<string>("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.source_header.toLowerCase().includes(s) || r.target_field.toLowerCase().includes(s));
  }, [rows, search]);

  const testResult = useMemo(() => {
    if (!testHeader.trim()) return null;
    const norm = normalizeHeader(testHeader);
    const hit = rows.find((r) => r.is_active && normalizeHeader(r.source_header) === norm);
    return { norm, target: hit?.target_field ?? null };
  }, [testHeader, rows]);

  const activeTargetFields = useMemo(() => new Set(fields.map((f) => f.field_name)), [fields]);

  const saveSourceHeader = async (r: DefectHeaderMappingRow, trimmed: string) => {
    const { error } = await (supabase as any)
      .from("defect_header_mappings")
      .update({ source_header: trimmed, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); throw error; }
    qc.invalidateQueries({ queryKey: DEFECT_HEADER_MAPPING_QK });
    await refetch();
  };

  const toggleActive = async (r: DefectHeaderMappingRow) => {
    const { error } = await (supabase as any)
      .from("defect_header_mappings")
      .update({ is_active: !r.is_active, updated_by: me?.id ?? null })
      .eq("id", r.id);
    if (error) return toast.error("실패", { description: error.message });
    qc.invalidateQueries({ queryKey: DEFECT_HEADER_MAPPING_QK });
    refetch();
  };

  const removeRow = async (r: DefectHeaderMappingRow) => {
    if (!r.is_custom) return toast.error("시스템 매핑", { description: "시스템 매핑은 삭제할 수 없습니다." });
    if (!confirm(`매핑 "${r.source_header}" → ${r.target_field} 을(를) 삭제하시겠습니까?`)) return;
    const { error } = await (supabase as any).from("defect_header_mappings").delete().eq("id", r.id);
    if (error) return toast.error("삭제 실패", { description: error.message });
    toast.success("삭제되었습니다");
    qc.invalidateQueries({ queryKey: DEFECT_HEADER_MAPPING_QK });
    refetch();
  };

  const submitNew = async () => {
    if (!newSource.trim() || !newTarget) return toast.error("필수 입력", { description: "원본 헤더와 대상 필드를 입력하세요." });
    const { error } = await (supabase as any).from("defect_header_mappings").insert({
      module: "defect",
      source_header: newSource.trim(),
      target_field: newTarget,
      is_custom: true,
      is_active: true,
      updated_by: me?.id ?? null,
    });
    if (error) return toast.error("추가 실패", { description: error.message });
    toast.success("매핑이 추가되었습니다");
    setAddOpen(false); setNewSource(""); setNewTarget("");
    qc.invalidateQueries({ queryKey: DEFECT_HEADER_MAPPING_QK });
    refetch();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Header Mapping — Defect Excel Import 별칭</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Defect Management 업로드용 Excel 원본 헤더를 시스템 필드에 연결합니다.</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Add Mapping</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded border bg-muted/30 p-3 space-y-2">
          <Label className="text-xs font-semibold">Mapping Test</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="원본 Excel 헤더 문자열 입력…" value={testHeader} onChange={(e) => setTestHeader(e.target.value)} className="h-8 max-w-md" />
            {testResult && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">norm: {testResult.norm}</Badge>
                {testResult.target ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">→ {testResult.target}</Badge>
                ) : (
                  <Badge variant="destructive">매칭 없음</Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <Input placeholder="원본 헤더 또는 대상 필드 검색…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />

        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source Header (Excel)</TableHead>
                <TableHead className="w-[220px]">Target Field</TableHead>
                <TableHead className="w-[90px]">Type</TableHead>
                <TableHead className="w-[90px] text-center">Active</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">매핑이 없습니다.</TableCell></TableRow>}
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <TableCell className="text-sm">
                    <EditableSourceHeaderCell row={r} rows={rows} activeTargetFields={activeTargetFields} onSave={(v) => saveSourceHeader(r, v)} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.target_field}</TableCell>
                  <TableCell>
                    {r.is_custom ? (<Badge variant="secondary">Custom</Badge>) : (<Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />System</Badge>)}
                  </TableCell>
                  <TableCell className="text-center"><Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => removeRow(r)} disabled={!r.is_custom} title={r.is_custom ? "삭제" : "시스템 매핑은 삭제할 수 없음"}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Header Mapping</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Source Header (Excel 원본 문자열)</Label>
              <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} />
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