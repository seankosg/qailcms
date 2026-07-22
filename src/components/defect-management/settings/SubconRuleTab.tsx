import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDefectSubconRules,
  useInsertSubconRule,
  useUpdateSubconRule,
  useDeleteSubconRule,
} from "@/hooks/useDefectAutoFillRules";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const splitKeywords = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

export function SubconRuleTab() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.roles?.includes("admin") || !!me?.roles?.includes("superuser");
  const { data: rows = [], isLoading } = useDefectSubconRules();
  const insert = useInsertSubconRule();
  const update = useUpdateSubconRule();
  const del = useDeleteSubconRule();

  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    plot: "D",
    room_group: "",
    trade_keywords: "",
    subcontractor_name: "",
    sort_order: 500,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.plot, r.room_group, r.subcontractor_name, ...(r.trade_keywords ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const handleAdd = async () => {
    if (!form.room_group.trim() || !form.subcontractor_name.trim() || !form.trade_keywords.trim()) {
      return toast.error("Room Group / Trade Keywords / Subcon 은 필수");
    }
    try {
      await insert.mutateAsync({
        plot: form.plot,
        room_group: form.room_group.trim(),
        trade_keywords: splitKeywords(form.trade_keywords),
        subcontractor_name: form.subcontractor_name.trim(),
        sort_order: form.sort_order,
        is_active: true,
      });
      toast.success("추가됨");
      setForm({ plot: form.plot, room_group: "", trade_keywords: "", subcontractor_name: "", sort_order: form.sort_order + 10 });
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
        Plot + Room Group(= Plan Group 또는 Room Group) + Trade 매칭으로 Subcontractor 를 자동으로 채웁니다.
        Trade 매칭은 <b>Main Trade / Sub Trade 정확 일치</b> → 미매치 시 <b>Description 부분 일치</b> 순으로 시도합니다.
        원본 엑셀에 값이 있거나 기존 DB 값이 있으면 덮어쓰지 않습니다.
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 Rule 추가</CardTitle>
            <CardDescription>Trade Keywords 는 콤마(,) 로 구분한 목록입니다. 각 키워드는 OR 조건.</CardDescription>
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
            <Field label="Room Group">
              <Input className="h-8 w-[220px] text-xs" value={form.room_group}
                onChange={(e) => setForm({ ...form, room_group: e.target.value })} />
            </Field>
            <Field label="Trade Keywords (콤마 구분)">
              <Input className="h-8 w-[320px] text-xs" value={form.trade_keywords}
                onChange={(e) => setForm({ ...form, trade_keywords: e.target.value })}
                placeholder="Floor Terrazzo, Resin, PU, epoxy" />
            </Field>
            <Field label="Subcontractor">
              <Input className="h-8 w-[160px] text-xs" value={form.subcontractor_name}
                onChange={(e) => setForm({ ...form, subcontractor_name: e.target.value })} />
            </Field>
            <Field label="Sort">
              <Input type="number" className="h-8 w-[80px] text-xs" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} />
            </Field>
            <Button size="sm" onClick={handleAdd} disabled={insert.isPending}>
              {insert.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              추가
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
                  <TableHead className="w-[220px]">Room Group</TableHead>
                  <TableHead className="min-w-[280px]">Trade Keywords</TableHead>
                  <TableHead className="w-[160px]">Subcontractor</TableHead>
                  <TableHead className="w-[70px]">Sort</TableHead>
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
                    <TableCell className="text-sm">{r.room_group}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(r.trade_keywords ?? []).map((kw, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">{kw}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.subcontractor_name}</TableCell>
                    <TableCell className="text-xs tabular-nums">{r.sort_order}</TableCell>
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
                          onClick={() => handleDelete(r.id, `${r.plot}/${r.room_group}/${r.subcontractor_name}`)}>
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