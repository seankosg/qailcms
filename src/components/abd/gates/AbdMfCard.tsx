import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isMfReady, MF_TYPES, MF_DS_BLOCK_MESSAGE } from "@/lib/abd/mf-ds-guard";
import { getAbdMfHistory, setAbdMf, type AbdMfChangeRow } from "@/lib/abd/mf-audit.functions";

interface Props {
  item: Record<string, any>;
  canEdit: boolean;
  onSaved: () => void;
}

export function AbdMfCard({ item, canEdit, onSaved }: Props) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setAbdMf);
  const historyFn = useServerFn(getAbdMfHistory);

  const [types, setTypes] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [revision, setRevision] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTypes(Array.isArray(item.mf_types) ? item.mf_types : []);
    setReference(item.mf_reference ?? "");
    setRevision(item.mf_revision ?? "");
    setReason("");
    setEditing(false);
  }, [item.id, item.mf_check, item.mf_reference, item.mf_revision]);

  const history = useQuery({
    queryKey: ["abd-mf-history", item.id],
    queryFn: async () => (await historyFn({ data: { itemId: item.id as string } })) as AbdMfChangeRow[],
    staleTime: 30_000,
  });

  const ready = isMfReady(item as any);
  const hasDs = [1, 2, 3].some((n) => !!item[`r${n}_draft_start_actual`]);

  async function save(nextCheck: boolean) {
    setSaving(true);
    try {
      await saveFn({
        data: {
          id: item.id as string,
          mf_check: nextCheck,
          mf_types: types as any,
          mf_reference: reference.trim() || null,
          mf_revision: revision.trim() || null,
          reason: reason.trim() || null,
        },
      });
      toast.success(nextCheck ? "MF Check 가 완료되었습니다." : "MF 정보가 저장되었습니다.");
      setEditing(false);
      onSaved();
      void qc.invalidateQueries({ queryKey: ["abd-mf-history", item.id] });
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scroll-mt-4" data-section="mf">
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        Gate 1 — Master Reference
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            ready
              ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
              : "bg-rose-500/15 text-rose-700 border-rose-500/30",
          )}
        >
          {ready ? "MF Check = Yes" : "MF Check = No"}
        </Badge>
        {item.mf_changed_after_ds && (
          <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30">
            DS 이후 MF 변경
          </Badge>
        )}
      </h3>

      {!ready && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-rose-800">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{MF_DS_BLOCK_MESSAGE}</span>
        </div>
      )}

      <div className="rounded-md border p-2 space-y-2">
        {!editing ? (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="col-span-2">
                <span className="text-muted-foreground">MF Type</span>
                <div className="font-medium flex flex-wrap gap-1 mt-0.5">
                  {(item.mf_types ?? []).length === 0
                    ? "—"
                    : (item.mf_types as string[]).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                </div>
              </div>
              <div><span className="text-muted-foreground">MF Reference</span><div className="font-medium">{item.mf_reference ?? "—"}</div></div>
              <div><span className="text-muted-foreground">MF Revision</span><div className="font-medium">{item.mf_revision ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Checked At</span><div className="font-medium">{item.mf_checked_at ? new Date(item.mf_checked_at).toLocaleString("ko-KR", { hour12: false }) : "—"}</div></div>
              <div className="flex items-end">
                {canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
                    {ready ? "MF 정보 수정" : "MF 확인 입력"}
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div>
              <Label className="text-[11px]">MF Type (복수 선택)</Label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {MF_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-[11px]">
                    <Checkbox
                      checked={types.includes(t)}
                      onCheckedChange={(v) =>
                        setTypes((prev) => (v ? [...prev, t] : prev.filter((x) => x !== t)))
                      }
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">MF Reference</Label>
                <Input className="h-8 text-xs" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="문서명 / 도면번호" />
              </div>
              <div>
                <Label className="text-[11px]">MF Revision</Label>
                <Input className="h-8 text-xs" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="Rev. / 발행일" />
              </div>
            </div>
            {hasDs && (
              <div>
                <Label className="text-[11px]">변경 사유 (DS 이후 변경 시 필수 권장)</Label>
                <Textarea className="text-xs" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs gap-1" disabled={saving} onClick={() => void save(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> MF Check 완료
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={saving} onClick={() => void save(false)}>
                임시 저장 (Check = No)
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>취소</Button>
            </div>
          </div>
        )}
      </div>

      {(history.data?.length ?? 0) > 0 && (
        <details className="mt-2 rounded-md border p-2">
          <summary className="cursor-pointer text-[11px] font-semibold">MF 변경 이력 ({history.data?.length})</summary>
          <div className="mt-2 space-y-1.5">
            {history.data?.map((h) => (
              <div key={h.id} className="rounded border p-1.5 text-[11px]">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{new Date(h.created_at).toLocaleString("ko-KR", { hour12: false })}</span>
                  <span>{h.changed_by_name ?? "—"}</span>
                  {h.after_ds && <Badge variant="outline" className="text-[10px]">DS 이후</Badge>}
                </div>
                <div className="mt-0.5">
                  <span className="text-muted-foreground">전 </span>
                  {(h.before_value?.mf_types ?? []).join(", ") || "—"} / {h.before_value?.mf_reference ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">후 </span>
                  {(h.after_value?.mf_types ?? []).join(", ") || "—"} / {h.after_value?.mf_reference ?? "—"}
                </div>
                {h.reason && <div className="mt-0.5">사유: {h.reason}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}