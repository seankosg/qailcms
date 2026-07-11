import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import {
  useSparePartFieldConfig,
  SPARE_PART_FIELD_CONFIG_QK,
  type SparePartFieldConfigRow,
} from "@/hooks/useSparePartFieldConfig";
import { SPARE_PART_COLUMNS } from "@/lib/spare-part/columns";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type DraftMap = Record<string, Partial<Pick<SparePartFieldConfigRow, "display_name" | "is_visible" | "sort_order" | "note">>>;

export function FieldConfigTable() {
  const { data: rows = [], isLoading, refetch } = useSparePartFieldConfig();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [saving, setSaving] = useState(false);

  const merged = useMemo(() => {
    return rows.map((r) => ({ ...r, ...(drafts[r.id] ?? {}) })).sort((a, b) => a.sort_order - b.sort_order);
  }, [rows, drafts]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return merged;
    return merged.filter(
      (r) => r.field_name.toLowerCase().includes(s) || r.display_name.toLowerCase().includes(s),
    );
  }, [merged, search]);

  const setDraft = (id: string, patch: DraftMap[string]) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? {}), ...patch } }));
  };

  const dirtyCount = Object.keys(drafts).length;

  const saveAll = async () => {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      const updates = Object.entries(drafts).map(([id, patch]) =>
        (supabase as any)
          .from("spare_part_field_config")
          .update({ ...patch, updated_by: me?.id ?? null })
          .eq("id", id),
      );
      const results = await Promise.all(updates);
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;
      toast.success(`${dirtyCount}개 필드 저장 완료`);
      setDrafts({});
      qc.invalidateQueries({ queryKey: SPARE_PART_FIELD_CONFIG_QK });
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
        SPARE_PART_COLUMNS.map((c, i) =>
          (supabase as any)
            .from("spare_part_field_config")
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
      toast.success("기본값으로 되돌렸습니다" );
      setDrafts({});
      qc.invalidateQueries({ queryKey: SPARE_PART_FIELD_CONFIG_QK });
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
          <CardTitle className="text-base">Field Config — Raw Data 컬럼 헤더</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Raw Data 표의 컬럼 라벨/기본 노출/기본 정렬을 편집합니다. 저장 시 즉시 반영됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || !dirtyCount}>
            <Save className="mr-1 h-3.5 w-3.5" />
            저장{dirtyCount ? ` (${dirtyCount})` : ""}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="필드명 또는 라벨 검색…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Order</TableHead>
                <TableHead className="w-[220px]">Field Name</TableHead>
                <TableHead>Display Name (헤더 라벨)</TableHead>
                <TableHead className="w-[100px]">Group</TableHead>
                <TableHead className="w-[90px] text-center">Visible</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">일치하는 필드가 없습니다.</TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const dirty = !!drafts[r.id];
                return (
                  <TableRow key={r.id} className={dirty ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}>
                    <TableCell>
                      <Input
                        type="number"
                        value={r.sort_order}
                        onChange={(e) => setDraft(r.id, { sort_order: Number(e.target.value) || 0 })}
                        className="h-8 w-20"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.field_name}</TableCell>
                    <TableCell>
                      <Input
                        value={r.display_name}
                        onChange={(e) => setDraft(r.id, { display_name: e.target.value })}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      {r.group_key ? <Badge variant="secondary" className="text-[10px]">{r.group_key}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={r.is_visible}
                        onCheckedChange={(v) => setDraft(r.id, { is_visible: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.note ?? ""}
                        onChange={(e) => setDraft(r.id, { note: e.target.value })}
                        className="h-8 text-xs"
                        placeholder="메모"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {dirtyCount > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            저장되지 않은 변경 {dirtyCount}건이 있습니다. 상단의 저장 버튼을 눌러 반영하세요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
