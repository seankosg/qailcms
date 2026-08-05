import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AUDIT_STATUSES, AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE } from "@/lib/abd/mf-ds-guard";
import { getAbdAuditHistory, setAbdAuditStatus, type AbdAuditLogRow } from "@/lib/abd/mf-audit.functions";

interface Props {
  item: Record<string, any>;
  canAudit: boolean;
  onSaved: () => void;
}

export function AbdAuditCard({ item, canAudit, onSaved }: Props) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setAbdAuditStatus);
  const historyFn = useServerFn(getAbdAuditHistory);

  const current = String(item.audit_status ?? "not_audited");
  const [status, setStatus] = useState(current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(String(item.audit_status ?? "not_audited"));
    setNote("");
  }, [item.id, item.audit_status]);

  const history = useQuery({
    queryKey: ["abd-audit-history", item.id],
    queryFn: async () => (await historyFn({ data: { itemId: item.id as string } })) as AbdAuditLogRow[],
    staleTime: 30_000,
  });

  async function save() {
    setSaving(true);
    try {
      await saveFn({ data: { id: item.id as string, status: status as any, note: note.trim() || null, reason: item.audit_reason ?? null } });
      toast.success("감사 상태가 저장되었습니다.");
      onSaved();
      void qc.invalidateQueries({ queryKey: ["abd-audit-history", item.id] });
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scroll-mt-4" data-section="audit">
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        표본감사
        <Badge variant="outline" className={cn("text-[10px]", AUDIT_STATUS_TONE[current])}>
          {AUDIT_STATUS_LABEL[current] ?? current}
        </Badge>
        {item.is_reopened && (
          <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30">Reopened</Badge>
        )}
      </h3>

      <div className="rounded-md border p-2 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div><span className="text-muted-foreground">선정 사유</span><div className="font-medium">{item.audit_reason ?? "—"}</div></div>
          <div><span className="text-muted-foreground">감사일</span><div className="font-medium">{item.audit_at ? new Date(item.audit_at).toLocaleString("ko-KR", { hour12: false }) : "—"}</div></div>
          <div className="col-span-2"><span className="text-muted-foreground">감사 메모</span><div className="font-medium whitespace-pre-wrap">{item.audit_note ?? "—"}</div></div>
        </div>

        {canAudit && (
          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center gap-2">
              <Label className="text-[11px] shrink-0">상태</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{AUDIT_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => void save()}>저장</Button>
            </div>
            <Textarea
              className="text-xs"
              rows={2}
              placeholder="감사 메모 (실패 / 수정요청 시 필수)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
      </div>

      {(history.data?.length ?? 0) > 0 && (
        <details className="mt-2 rounded-md border p-2">
          <summary className="cursor-pointer text-[11px] font-semibold">감사 이력 ({history.data?.length})</summary>
          <div className="mt-2 space-y-1.5">
            {history.data?.map((h) => (
              <div key={h.id} className="rounded border p-1.5 text-[11px]">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{new Date(h.created_at).toLocaleString("ko-KR", { hour12: false })}</span>
                  <span>{h.actor_name ?? "—"}</span>
                </div>
                <div>
                  {(AUDIT_STATUS_LABEL[h.from_status ?? ""] ?? h.from_status ?? "—")} → {AUDIT_STATUS_LABEL[h.to_status] ?? h.to_status}
                </div>
                {h.reason && <div>사유: {h.reason}</div>}
                {h.note && <div>메모: {h.note}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}