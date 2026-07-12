import { useState } from "react";
import { Button } from "@/components/ui/button";
import { bulkToggleCritical } from "@/lib/defect-management/mutations.functions";
import { toast } from "sonner";

interface Props {
  pending: Map<string, boolean>;
  onApplied: (applied: Map<string, boolean>) => void;
  onDiscard: () => void;
}

export function CriticalPendingBar({ pending, onApplied, onDiscard }: Props) {
  const [busy, setBusy] = useState(false);
  if (pending.size === 0) return null;

  const apply = async () => {
    setBusy(true);
    try {
      // Group by target boolean value
      const trueIds: string[] = [];
      const falseIds: string[] = [];
      pending.forEach((v, id) => (v ? trueIds : falseIds).push(id));
      if (trueIds.length) await bulkToggleCritical({ data: { ids: trueIds, value: true } });
      if (falseIds.length) await bulkToggleCritical({ data: { ids: falseIds, value: false } });
      toast.success(`Critical ${pending.size}건 적용`);
      onApplied(pending);
    } catch (e: any) {
      toast.error(`적용 실패: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-background shadow-lg px-4 py-2 flex items-center gap-3">
      <span className="text-xs">
        Critical 변경 대기 <b>{pending.size}</b>건
      </span>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDiscard} disabled={busy}>취소</Button>
      <Button size="sm" className="h-7 text-xs" onClick={apply} disabled={busy}>{busy ? "적용 중..." : "적용"}</Button>
    </div>
  );
}