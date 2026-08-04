import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROLE_LABELS, type AppRole } from "@/types/enums";

type PreviewRow = {
  line: number;
  name: string;
  role: string;
  user_id: string | null;
  current_role: string | null;
  match_count: number;
  class: "change" | "unchanged" | "not_found" | "duplicate" | "invalid_role";
};

const CLASS_LABEL: Record<PreviewRow["class"], string> = {
  change: "변경",
  unchanged: "변경없음",
  not_found: "못찾음",
  duplicate: "중복",
  invalid_role: "등급 오류",
};

/** "이름<탭|쉼표|공백2칸>등급" 형태의 붙여넣기를 파싱한다. 빈 줄은 무시. */
function parseLines(text: string): { line: number; name: string; role: string }[] {
  const out: { line: number; name: string; role: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    const parts = raw.split(/\t|,|;|\s{2,}|\s+/).filter(Boolean);
    const role = (parts.pop() ?? "").trim();
    const name = parts.join(" ").trim();
    out.push({ line: i + 1, name, role });
  }
  return out;
}

export function BulkRoleAssignTab() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const items = useMemo(() => parseLines(text), [text]);

  const counts = useMemo(() => {
    const c = { change: 0, unchanged: 0, not_found: 0, duplicate: 0, invalid_role: 0 };
    for (const r of preview ?? []) c[r.class] = (c[r.class] ?? 0) + 1;
    return c;
  }, [preview]);

  const sum = counts.change + counts.unchanged + counts.not_found + counts.duplicate + counts.invalid_role;
  const countsMatch = preview !== null && sum === items.length;
  const hasUnresolved = counts.not_found + counts.duplicate + counts.invalid_role > 0;
  const canRun = preview !== null && countsMatch && !hasUnresolved && counts.change > 0 && !busy;

  const runPreview = async () => {
    setBusy(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.rpc("rcl_bulk_role_preview" as any, { _items: items });
      if (error) throw error;
      setPreview((data ?? []) as PreviewRow[]);
    } catch (e) {
      toast.error(`미리보기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("rcl_bulk_role_apply" as any, { _items: items });
      if (error) throw error;
      toast.success(`역할 일괄 지정 완료 — 변경 ${(data as any)?.applied ?? 0}명`);
      setPreview(null);
      setText("");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      await qc.invalidateQueries({ queryKey: ["current-user"] });
    } catch (e) {
      toast.error(`실행 실패(전체 미반영): ${(e as Error).message}`, { duration: 10000 });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">역할 일괄 지정</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            한 줄에 <b>이름 + 등급</b>. 구분자는 탭 · 쉼표 · 공백. 등급 코드:{" "}
            {(["admin", "superuser", "d_superuser", "senior_user", "user", "super_guest", "guest"] as AppRole[])
              .map((r) => `${r}(${ROLE_LABELS[r]})`).join(" · ")}
            {". "}이름 판정은 <code>resolve_user_by_name</code> 단독이며 동명이인은 중복으로 분류되어 실행이 막힙니다.
            명단에 없는 사람은 <b>변경하지 않습니다</b>.
          </p>
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder={"고현봉\tadmin\n홍길동, senior_user"}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">입력 줄 {items.length}</Badge>
            <Button size="sm" variant="outline" disabled={items.length === 0 || busy} onClick={() => void runPreview()}>
              미리보기
            </Button>
            <Button size="sm" disabled={!canRun} onClick={() => setConfirmOpen(true)}>실행</Button>
            {preview !== null && !countsMatch && (
              <span className="text-xs text-destructive">
                입력 줄 {items.length} ≠ 4분류 합 {sum} — 실행 차단
              </span>
            )}
            {preview !== null && hasUnresolved && (
              <span className="text-xs text-destructive">
                못찾음 {counts.not_found} · 중복 {counts.duplicate} · 등급 오류 {counts.invalid_role} — 실행 차단
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {preview !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              미리보기 — 변경 {counts.change} / 변경없음 {counts.unchanged} / 못찾음 {counts.not_found} / 중복 {counts.duplicate}
              {counts.invalid_role > 0 ? ` / 등급 오류 ${counts.invalid_role}` : ""} (합 {sum} · 입력 {items.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">줄</TableHead><TableHead>이름</TableHead>
                  <TableHead>현재 등급</TableHead><TableHead>요청 등급</TableHead>
                  <TableHead>분류</TableHead><TableHead className="w-20">일치 수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                    <TableCell className="text-sm font-medium">{r.name || <span className="text-muted-foreground">(빈칸)</span>}</TableCell>
                    <TableCell className="text-xs">{r.current_role ? ROLE_LABELS[r.current_role as AppRole] ?? r.current_role : "-"}</TableCell>
                    <TableCell className="text-xs">{ROLE_LABELS[r.role as AppRole] ?? r.role}</TableCell>
                    <TableCell>
                      <Badge variant={r.class === "change" ? "default" : r.class === "unchanged" ? "secondary" : "destructive"} className="text-[10px]">
                        {CLASS_LABEL[r.class]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.match_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>역할 일괄 지정 실행</AlertDialogTitle>
            <AlertDialogDescription>
              {counts.change}명의 등급을 바꿉니다. 한 트랜잭션으로 처리되며 하나라도 실패하면 전부 반영되지 않습니다.
              본인 하향 · Admin 0명이 되는 변경은 거부됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void runApply(); }}>실행</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}