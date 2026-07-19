import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { PreflightSummary } from "@/lib/task-management/import-preflight.functions";

const REASON_LABEL: Record<string, string> = {
  task_name_mismatch: "이름 불일치",
  parent_mismatch: "Main Task 불일치",
  plot_mismatch: "Plot 불일치",
};

export function ConflictReviewDialog({
  open,
  onClose,
  fileName,
  preflight,
}: {
  open: boolean;
  onClose: () => void;
  fileName: string;
  preflight: PreflightSummary | null | undefined;
}) {
  const conflicts = preflight?.conflicts ?? [];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>충돌 상세 — {fileName}</DialogTitle>
          <DialogDescription>
            같은 <code>task_no</code>가 DB에 이미 존재하지만 이름/상위/Plot이 실질적으로 달라 다른 태스크로 의심되는 행입니다. 파일 카드의 <b>충돌 정책</b>에 따라 처리됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
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
              </tr>
            </thead>
            <tbody>
              {conflicts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                    충돌이 없습니다.
                  </td>
                </tr>
              )}
              {conflicts.map((c) => (
                <tr key={c.task_no} className="border-t align-top">
                  <td className="px-2 py-1.5 font-mono">{c.task_no}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className="border-destructive/50 text-destructive">
                      {REASON_LABEL[c.reason] ?? c.reason}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5">{c.db.task_name ?? "—"}</td>
                  <td className="px-2 py-1.5 text-primary">{c.file.task_name ?? "—"}</td>
                  <td className="px-2 py-1.5">{c.db.main_task_no ?? "—"}</td>
                  <td className="px-2 py-1.5 text-primary">{c.file.main_task_no ?? "—"}</td>
                  <td className="px-2 py-1.5">{c.db.plot ?? "—"}</td>
                  <td className="px-2 py-1.5 text-primary">{c.file.plot ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}