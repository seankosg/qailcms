import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DEFECT_TEAMS, TEAM_COLORS, TEAM_FALLBACK_COLOR, type DefectTeam } from "@/lib/defect-management/columns";
import {
  useDefectCategoryTeamMap,
  useUpsertCategoryTeamMap,
  useDeleteCategoryTeamMap,
} from "@/hooks/useDefectCategoryTeamMap";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";

export function DefectCategoryTeamMapPage() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.roles?.includes("admin") || !!me?.roles?.includes("superuser");
  const { data: rows = [], isLoading } = useDefectCategoryTeamMap();
  const upsert = useUpsertCategoryTeamMap();
  const del = useDeleteCategoryTeamMap();

  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTeam, setNewTeam] = useState<DefectTeam>("Arch");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.category.toLowerCase().includes(q) || r.team.toLowerCase().includes(q));
  }, [rows, search]);

  const grouped = useMemo(() => {
    const g: Record<DefectTeam, number> = { Arch: 0, Mech: 0, Elec: 0 };
    for (const r of rows) g[r.team] = (g[r.team] ?? 0) + 1;
    return g;
  }, [rows]);

  const handleAdd = async () => {
    const cat = newCategory.trim();
    if (!cat) return toast.error("Category 를 입력하세요");
    try {
      await upsert.mutateAsync({ category: cat, team: newTeam });
      toast.success(`추가/갱신 완료: ${cat} → ${newTeam}`);
      setNewCategory("");
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    }
  };

  const handleUpdateTeam = async (category: string, team: DefectTeam) => {
    try {
      await upsert.mutateAsync({ category, team });
      toast.success(`${category} → ${team}`);
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    }
  };

  const handleDelete = async (category: string) => {
    if (!confirm(`"${category}" 매핑을 삭제할까요?`)) return;
    try {
      await del.mutateAsync(category);
      toast.success("삭제됨");
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? e}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Snag List Settings — Category → Team</h1>
        <p className="text-sm text-muted-foreground">
          Snag List 임포트 시 각 행의 <code>Category</code> 값에 따라 자동으로 채워지는 팀을 관리합니다.
          현재 팀 값: <b>Arch</b>(건축) · <b>Mech</b>(설비) · <b>Elec</b>(전기)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DEFECT_TEAMS.map((t) => (
          <Badge key={t} className={cn("text-[11px]", TEAM_COLORS[t] ?? TEAM_FALLBACK_COLOR)}>
            {t}: {grouped[t] ?? 0}
          </Badge>
        ))}
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 매핑 추가</CardTitle>
            <CardDescription>동일 Category 를 다시 저장하면 기존 매핑이 갱신됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Category</div>
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="예: Landscape"
                className="h-8 w-[220px] text-xs"
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Team</div>
              <Select value={newTeam} onValueChange={(v) => setNewTeam(v as DefectTeam)}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEFECT_TEAMS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleAdd} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              추가
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">매핑 목록 ({rows.length})</CardTitle>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색..."
            className="h-8 w-[220px] text-xs"
          />
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
                  <TableHead className="w-[280px]">Category</TableHead>
                  <TableHead className="w-[140px]">Team</TableHead>
                  <TableHead>Updated</TableHead>
                  {canEdit && <TableHead className="w-[80px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 4 : 3} className="text-center text-xs text-muted-foreground py-6">
                      매핑이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.category}>
                    <TableCell className="font-medium text-sm">{r.category}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Select
                          value={r.team}
                          onValueChange={(v) => handleUpdateTeam(r.category, v as DefectTeam)}
                        >
                          <SelectTrigger className="h-7 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEFECT_TEAMS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={cn("text-[10px]", TEAM_COLORS[r.team] ?? TEAM_FALLBACK_COLOR)}>{r.team}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleDelete(r.category)}
                          disabled={del.isPending}
                          title="삭제"
                        >
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