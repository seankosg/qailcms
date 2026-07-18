import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { PreflightSummary } from "@/lib/task-management/import-preflight.functions";
import type { ConflictPolicy } from "@/contexts/TaskManagementImportContext";

const REASON_LABEL: Record<string, string> = {
  task_name_mismatch: "이름 불일치",
  parent_mismatch: "상위 태스크 불일치",
  plot_mismatch: "Plot 불일치",
};

const POLICY_LABEL: Record<ConflictPolicy, string> = {
  overwrite: "덮어쓰기",
  skip: "건너뛰기",
  renumber: "재번호",
};

interface ConflictDecisionDialogProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  preflight: PreflightSummary | null | undefined;
  defaultPolicy: ConflictPolicy;
  initialDecisions?: Record<string, ConflictPolicy>;
  onConfirm: (decisions: Record<string, ConflictPolicy>) => void;
}

export function ConflictDecisionDialog({
  open,
  onClose,
  fileName,
  preflight,
  defaultPolicy,
  initialDecisions = {},
  onConfirm,
}: ConflictDecisionDialogProps) {
  const conflicts = preflight?.conflicts ?? [];
  const [decisions, setDecisions] = useState<Record<string, ConflictPolicy>>({});

  useEffect(() => {
    if (open) {
      setDecisions({ ...initialDecisions });
    }
  }, [open, initialDecisions]);

  const setAll = (policy: ConflictPolicy) => {
    const next: Record<string, ConflictPolicy> = {};
    for (const c of conflicts) {
      next[c.task_no] = policy;
    }
    setDecisions(next);
  };

  const setOne = (taskNo: string, policy: ConflictPolicy) => {
    setDecisions((cur) => ({ ...cur, [taskNo]: policy }));
  };

  const unresolvedCount = conflicts.filter((c) => !decisions[c.task_no]).length;
  const resolvedCount = conflicts.length - unresolvedCount;

  const handleConfirm = () => {
    onConfirm(decisions);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>충돌 처리 — {fileName}</DialogTitle>
          <DialogDescription>
            같은 <code>task_no</code>가 DB에 이미 존재합니다. 각 행별로 처리 방식을 선택하세요. 선택하지 않은 행은 파일 기본 정책 "{POLICY_LABEL[defaultPolicy]}"으로 처리됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-300 text-emerald-700">
              신규 {preflight?.newCount ?? 0}
            </Badge>
            <Badge variant="outline" className="border-blue-300 text-blue-700">
              업데이트 {preflight?.updateCount ?? 0}
            </Badge>
            <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
              변경 없음 {preflight?.unchangedCount ?? 0}
            </Badge>
            <Badge variant="outline" className="border-destructive text-destructive">
              충돌 {preflight?.conflictCount ?? 0}
            </Badge>
            {resolvedCount > 0 && (
              <Badge variant="outline" className="border-violet-300 text-violet-700">
                개별 결정 {resolvedCount}건
              </Badge>
            )}
            {unresolvedCount > 0 && (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                미결정 {unresolvedCount}건
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAll("overwrite")}>
              전체 덮어쓰기
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAll("skip")}>
              전체 건너뛰기
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAll("renumber")}>
              전체 재번호
            </Button>
          </div>
        </div>
        <ScrollArea className="h-[420px] rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                <th className="px-2 py-1.5">task_no</th>
                <th className="px-2 py-1.5">사유</th>
                <th className="px-2 py-1.5">DB task_name</th>
                <th className="px-2 py-1.5">파일 task_name</th>
                <th className="px-2 py-1.5">DB parent</th>
                <th className="px-2 py-1.5">파일 parent</th>
                <th className="px-2 py-1.5">DB plot</th>
                <th className="px-2 py-1.5">파일 plot</th>
                <th className="px-2 py-1.5">처리</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">
                    충돌이 없습니다.
                  </td>
                </tr>
              )}
              {conflicts.map((c) => {
                const value = decisions[c.task_no] ?? defaultPolicy;
                return (
                  <tr key={c.task_no} className="border-t align-top">
                    <td className="px-2 py-1.5 font-mono">{c.task_no}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant="outline" className="border-destructive/50 text-destructive">
                        {REASON_LABEL[c.reason] ?? c.reason}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">{c.db.task_name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-primary">{c.file.task_name ?? "—"}</td>
                    <td className="px-2 py-1.5">{c.db.parent_task_no ?? "—"}</td>
                    <td className="px-2 py-1.5 text-primary">{c.file.parent_task_no ?? "—"}</td>
                    <td className="px-2 py-1.5">{c.db.plot ?? "—"}</td>
                    <td className="px-2 py-1.5 text-primary">{c.file.plot ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <RadioGroup
                        value={value}
                        onValueChange={(v) => setOne(c.task_no, v as ConflictPolicy)}
                        className="flex flex-col gap-1"
                      >
                        {(["overwrite", "skip", "renumber"] as ConflictPolicy[]).map((p) => (
                          <div key={p} className="flex items-center gap-1.5">
                            <RadioGroupItem value={p} id={`${c.task_no}-${p}`} className="h-3.5 w-3.5" />
                            <Label htmlFor={`${c.task_no}-${p}`} className="cursor-pointer text-[11px] font-normal">
                              {POLICY_LABEL[p]}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            미결정 {unresolvedCount}건은 기본 정책 "{POLICY_LABEL[defaultPolicy]}"으로 처리됩니다.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <Button size="sm" onClick={handleConfirm}>
              확인 ({resolvedCount}/{conflicts.length} 결정)
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
