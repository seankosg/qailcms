/**
 * 조직도 인원 정보(직책 · 직급 · 소속 팀 · 상급자 · 표시순서) 편집 다이얼로그.
 * 권한: 관리자(Admin / Superuser) 이상. 정본 판정은 `hdec_pic_name_master` RLS.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DUTY_OPTIONS, RANK_OPTIONS, levelOfRank, type OrgPic } from "./org-chart-consts";

const NONE = "__none__";

export function OrgPicEditDialog({
  pic, all, teams, open, onOpenChange,
}: {
  pic: OrgPic | null;
  all: OrgPic[];
  teams: { code: string; name: string }[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [duty, setDuty] = useState(NONE);
  const [rank, setRank] = useState(NONE);
  const [team, setTeam] = useState(NONE);
  const [parent, setParent] = useState(NONE);
  const [sort, setSort] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pic) return;
    setDuty(pic.duty_title ?? NONE);
    setRank(pic.rank_title ?? NONE);
    setTeam(pic.team_code ?? NONE);
    setParent(pic.parent_pic_id ?? NONE);
    setSort(String(pic.sort_order ?? 0));
  }, [pic]);

  if (!pic) return null;

  const save = async () => {
    setBusy(true);
    const rankTitle = rank === NONE ? null : rank;
    const { error } = await (supabase as any)
      .from("hdec_pic_name_master")
      .update({
        duty_title: duty === NONE ? null : duty,
        rank_title: rankTitle,
        rank_level: levelOfRank(rankTitle),
        team_code: team === NONE ? null : team,
        parent_pic_id: parent === NONE ? null : parent,
        sort_order: Number(sort) || 0,
      })
      .eq("id", pic.id);
    setBusy(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(`${pic.name} 조직정보를 저장했습니다.`);
    await qc.invalidateQueries({ queryKey: ["org-chart"] });
    onOpenChange(false);
  };

  const parentCandidates = all
    .filter((p) => p.id !== pic.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pic.name} — 조직정보</DialogTitle>
          <DialogDescription>직책과 직급은 별도로 관리합니다. 상급자를 지정하면 해당 인원 아래로 배치됩니다.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">직책</Label>
            <Select value={duty} onValueChange={setDuty}>
              <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>미지정</SelectItem>
                {DUTY_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">직급</Label>
            <Select value={rank} onValueChange={setRank}>
              <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>미지정</SelectItem>
                {RANK_OPTIONS.map((r) => <SelectItem key={r.title} value={r.title}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">소속 팀</Label>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>미배정</SelectItem>
                {teams.map((t) => <SelectItem key={t.code} value={t.code}>{t.name} ({t.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">상급자</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger className="h-9"><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>없음 (팀 직속)</SelectItem>
                {parentCandidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.duty_title ? ` · ${p.duty_title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">표시 순서</Label>
            <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}