import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RotateCcw, Save, GripVertical } from "lucide-react";
import {
  useDefectFieldConfig,
  DEFECT_FIELD_CONFIG_QK,
  type DefectFieldConfigRow,
} from "@/hooks/useDefectFieldConfig";
import { DEFECT_COLUMNS, GROUP_HEADER_BG } from "@/lib/defect-management/columns";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type DraftMap = Record<
  string,
  Partial<
    Pick<
      DefectFieldConfigRow,
      | "display_name"
      | "is_visible"
      | "sort_order"
      | "note"
      | "group_key"
      | "origin"
      | "source_label"
    >
  >
>;

const GROUP_OPTIONS = Object.keys(GROUP_HEADER_BG);
const ORIGIN_OPTIONS: Array<"hdec" | "aconex" | "system"> = [
  "hdec",
  "aconex",
  "system",
];

export function DefectFieldConfigTable() {
  const { data: rows = [], isLoading, refetch } = useDefectFieldConfig();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const merged = useMemo(
    () => rows.map((r) => ({ ...r, ...(drafts[r.id] ?? {}) })).sort((a, b) => a.sort_order - b.sort_order),
    [rows, drafts],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return merged;
    return merged.filter((r) => r.field_name.toLowerCase().includes(s) || r.display_name.toLowerCase().includes(s));
  }, [merged, search]);

  const setDraft = (id: string, patch: DraftMap[string]) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? {}), ...patch } }));
  };
  const dirtyCount = Object.keys(drafts).length;

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...merged];
    const from = list.findIndex((x) => x.id === fromId);
    const to = list.findIndex((x) => x.id === toId);
    if (from === -1 || to === -1) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setDrafts((d) => {
      const next = { ...d };
      list.forEach((row, i) => {
        const newOrder = (i + 1) * 10;
        if (row.sort_order !== newOrder) {
          next[row.id] = { ...(next[row.id] ?? {}), sort_order: newOrder };
        }
      });
      return next;
    });
  };

  const saveAll = async () => {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      const results = await Promise.all(
        Object.entries(drafts).map(([id, patch]) =>
          (supabase as any)
            .from("defect_field_config")
            .update({ ...patch, updated_by: me?.id ?? null })
            .eq("id", id),
        ),
      );
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;
      toast.success(`${dirtyCount}개 필드 저장 완료`);
      setDrafts({});
      qc.invalidateQueries({ queryKey: DEFECT_FIELD_CONFIG_QK });
      refetch();
    } catch (e: any) {
      toast.error("저장 실패", { description: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm("모든 필드의 Display Name / 정렬 / 노출을 코드 기본값으로 되돌립니다. 계속하시겠습니까?")) return;
    setSaving(true);
    try {
      const results = await Promise.all(
        DEFECT_COLUMNS.map((c, i) =>
          (supabase as any)
            .from("defect_field_config")
            .update({
              display_name: c.label,
              is_visible: true,
              sort_order: (i + 1) * 10,
              group_key: c.group,
              updated_by: me?.id ?? null,
            })
            .eq("field_name", c.key),
        ),
      );
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;
      toast.success("기본값으로 되돌렸습니다");
      setDrafts({});
      qc.invalidateQueries({ queryKey: DEFECT_FIELD_CONFIG_QK });
      refetch();
    } catch (e: any) {
      toast.error("실패", { description: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Field Config — Defect Raw Data 컬럼 헤더</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Defect Management Raw Data 표의 컬럼 라벨/기본 노출/기본 정렬을 편집합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || !dirtyCount}>
            <Save className="mr-1 h-3.5 w-3.5" /> 저장{dirtyCount ? ` (${dirtyCount})` : ""}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="필드명 또는 라벨 검색…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="w-[70px]">Order</TableHead>
                <TableHead className="w-[220px]">Field Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead className="w-[130px]">Group</TableHead>
                <TableHead className="w-[110px]">Origin</TableHead>
                <TableHead className="w-[110px]">Source Label</TableHead>
                <TableHead className="w-[90px] text-center">Visible</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">일치하는 필드가 없습니다.</TableCell></TableRow>
              )}
              {filtered.map((r) => {
                const dirty = !!drafts[r.id];
                return (
                  <TableRow
                    key={r.id}
                    draggable
                    onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== r.id) reorder(dragId, r.id); }}
                    onDragEnd={() => setDragId(null)}
                    className={`${dirty ? "bg-amber-50/50 dark:bg-amber-900/10" : ""} ${dragId === r.id ? "opacity-50" : ""}`}
                  >
                    <TableCell className="cursor-grab active:cursor-grabbing text-muted-foreground"><GripVertical className="h-4 w-4" /></TableCell>
                    <TableCell>
                      <Input type="number" value={r.sort_order} onChange={(e) => setDraft(r.id, { sort_order: Number(e.target.value) || 0 })} className="h-8 w-20" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.field_name}</TableCell>
                    <TableCell>
                      <Input value={r.display_name} onChange={(e) => setDraft(r.id, { display_name: e.target.value })} className="h-8" />
                    </TableCell>
                    <TableCell>
                      <Select value={r.group_key ?? ""} onValueChange={(v) => setDraft(r.id, { group_key: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {GROUP_OPTIONS.map((g) => (<SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.origin ?? ""}
                        onValueChange={(v) =>
                          setDraft(r.id, {
                            origin: v as "hdec" | "aconex" | "system",
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {ORIGIN_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o} className="text-xs">
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.source_label ?? ""}
                        onChange={(e) => setDraft(r.id, { source_label: e.target.value })}
                        className="h-8 text-xs"
                        placeholder="HDEC / Aconex …"
                      />
                    </TableCell>
                    <TableCell className="text-center"><Switch checked={r.is_visible} onCheckedChange={(v) => setDraft(r.id, { is_visible: v })} /></TableCell>
                    <TableCell>
                      <Input value={r.note ?? ""} onChange={(e) => setDraft(r.id, { note: e.target.value })} className="h-8 text-xs" placeholder="메모" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {dirtyCount > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">저장되지 않은 변경 {dirtyCount}건이 있습니다.</p>}
      </CardContent>
    </Card>
  );
}