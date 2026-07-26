import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { computeReviseDraft, applyReviseDraft, type AbdReviseDraft } from "@/lib/abd/revise.functions";

interface Props {
  itemId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApplied?: () => void;
}

const FIELDS = [
  { key: "ds", label: "Draft Start" },
  { key: "df", label: "Draft Finish" },
  { key: "sb", label: "Submission" },
  { key: "rs", label: "Response" },
] as const;

export function AbdReviseDraftDialog({ itemId, open, onOpenChange, onApplied }: Props) {
  const qc = useQueryClient();
  const computeFn = useServerFn(computeReviseDraft);
  const applyFn = useServerFn(applyReviseDraft);

  const { data: draft, isLoading } = useQuery<AbdReviseDraft | null>({
    queryKey: ["abd-revise-draft", itemId],
    enabled: open && !!itemId,
    queryFn: async () => (itemId ? await computeFn({ data: { id: itemId } }) : null),
    staleTime: 0,
  });

  const [values, setValues] = useState<{ ds: string; df: string; sb: string; rs: string }>({ ds: "", df: "", sb: "", rs: "" });

  useEffect(() => {
    if (draft) {
      setValues({
        ds: draft.suggested.ds ?? "",
        df: draft.suggested.df ?? "",
        sb: draft.suggested.sb ?? "",
        rs: draft.suggested.rs ?? "",
      });
    }
  }, [draft]);

  const apply = useMutation({
    mutationFn: async () => {
      if (!draft || !itemId) throw new Error("초안이 없습니다");
      return applyFn({
        data: {
          id: itemId,
          round_target: draft.round_target,
          ds: values.ds || null,
          df: values.df || null,
          sb: values.sb || null,
          rs: values.rs || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("계획이 적용되었습니다");
      qc.invalidateQueries({ queryKey: ["abd-attention-inbox"] });
      qc.invalidateQueries({ queryKey: ["abd-items"] });
      qc.invalidateQueries({ queryKey: ["abd-dash-row2"] });
      onApplied?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "적용 실패"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>계획수정 초안 생성</DialogTitle>
          <DialogDescription>
            {draft
              ? `R${draft.source_round} Response 실적일(${draft.response_actual}) 다음날을 ${draft.round_target.toUpperCase()} DS로 설정하고, 기존 계획 간격을 유지합니다.`
              : "초안 계산 중..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</div>}

        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-[100px_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground border-b pb-1">
              <div>필드</div>
              <div>현재 (Before)</div>
              <div>초안 (After · 수정 가능)</div>
            </div>
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                <div className="text-xs font-medium">{f.label}</div>
                <div className="text-sm font-mono text-muted-foreground tabular-nums">
                  {draft.current[f.key] ?? "—"}
                </div>
                <Input
                  type="date"
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={() => apply.mutate()} disabled={!draft || apply.isPending}>
            {apply.isPending ? "적용 중…" : "적용"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}