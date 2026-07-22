import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDefectHdecPicRules,
  useUpsertHdecPicRule,
  useUpdateHdecPicRule,
  useDeleteHdecPicRule,
} from "@/hooks/useDefectAutoFillRules";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export function HdecPicRuleTab() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.roles?.includes("admin") || !!me?.roles?.includes("superuser");
  const { data: rows = [], isLoading } = useDefectHdecPicRules();
  const upsert = useUpsertHdecPicRule();
  const update = useUpdateHdecPicRule();
  const del = useDeleteHdecPicRule();

  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ plot: "D", building: "", room_group: "", hdec_pic: "", hdec_eng: "" });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.plot, r.building, r.room_group, r.hdec_pic, r.hdec_eng]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const handleAdd = async () => {
    if (!form.building.trim() || !form.room_group.trim()) {
      return toast.error("Building 과 Room Group 은 필수");
    }
    try {
      await upsert.mutateAsync({
        plot: form.plot,
        building: form.building.trim(),
        room_group: form.room_group.trim(),
        hdec_pic: form.hdec_pic.trim() || null,
        hdec_eng: form.hdec_eng.trim() || null,
        is_active: true,
      });
      toast.success("저장됨");
      setForm({ plot: form.plot, building: "", room_group: "", hdec_pic: "", hdec_eng: "" });
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    }
  };

  const handlePatch = async (id: string, patch: Record<string, unknown>) => {
    try {
      await update.mutateAsync({ id, ...patch });
    } catch (e: any) {
      toast.error(`갱신 실패: ${e?.message ?? e}`);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`"${label}" rule 을 삭제할까요?`)) return;
    try {
      await del.mutateAsync(id);
      toast.success("삭제됨");
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? e}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Plot + Building + Room Group(= Plan Group 또는 Room Group) 매칭 시 HDEC PIC 와 HDEC ENG 를 자동으로 채웁니다.
        원본 엑셀에 값이 있거나 기존 DB 값이 있으면 덮어쓰지 않습니다.
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 Rule 추가</CardTitle>
            <CardDescription>(Plot, Building, Room Group) 조합이 동일하면 기존 rule 이 갱신됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <Field label="Plot">
              <Select value={form.plot} onValueChange={(v) => setForm({ ...form, plot: v })}>
                <SelectTrigger className="h-8 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="C">C</SelectItem>
                  <SelectItem value="D">D</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Building">
              <Input className="h-8 w-[160px] text-xs" value={form.building}
                onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="Tower" />
            </Field>
            <Field label="Room Group">
              <Input className="h-8 w-[220px] text-xs" value={form.room_group}
                onChange={(e) => setForm({ ...form, room_group: e.target.value })} placeholder="BOH & Staircase" />
            </Field>
            <Field label="HDEC PIC">
              <Input className="h-8 w-[140px] text-xs" value={form.hdec_pic}
                onChange={(e) => setForm({ ...form, hdec_pic: e.target.value })} />
            </Field>
            <Field label="HDEC ENG">
              <Input className="h-8 w-[140px] text-xs" value={form.hdec_eng}
                onChange={(e) => setForm({ ...form, hdec_eng: e.target.value })} />
            </Field>
            <Button size="sm" onClick={handleAdd} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              추가/갱신
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Rule 목록 ({rows.length})</CardTitle>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="검색..." className="h-8 w-[220px] text-xs" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 로딩 중...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Plot</TableHead>
                  <TableHead className="w-[160px]">Building</TableHead>
                  <TableHead className="w-[240px]">Room Group</TableHead>
                  <TableHead className="w-[140px]">HDEC PIC</TableHead>
                  <TableHead className="w-[140px]">HDEC ENG</TableHead>
                  <TableHead className="w-[80px]">Active</TableHead>
                  {canEdit && <TableHead className="w-[60px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-xs text-muted-foreground py-6">
                      Rule 이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{r.plot}</TableCell>
                    <TableCell className="text-sm">{r.building}</TableCell>
                    <TableCell className="text-sm">{r.room_group}</TableCell>
                    <TableCell className="text-sm">{r.hdec_pic ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.hdec_eng ?? "—"}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.is_active}
                        disabled={!canEdit}
                        onCheckedChange={(v) => handlePatch(r.id, { is_active: v })}
                      />
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => handleDelete(r.id, `${r.plot}/${r.building}/${r.room_group}`)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}