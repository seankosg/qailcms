import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface RecountResult {
  recounted: number;
  mismatch_fixed: number;
  ok: number;
  pending: number;
  none: number;
  linked_comment_total: number;
  cached_complied_total: number;
}

/** OCS Check 캐시(abd_items_raw.ocs_*) 전량 재계산 — admin 전용 (서버에서 재검증) */
export function OcsRecountPanel() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RecountResult | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("abd_ocs_recount_all");
      if (error) throw error;
      setRes(data as RecountResult);
      const fixed = Number((data as RecountResult)?.mismatch_fixed ?? 0);
      toast.success(fixed > 0 ? `재계산 완료 — 불일치 ${fixed.toLocaleString()}건 보정` : "재계산 완료 — 불일치 없음");
    } catch (e: any) {
      toast.error(`재계산 실패: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OCS Check 캐시 재계산</CardTitle>
        <CardDescription>
          Raw Data 의 OCS Check 값은 코멘트/Complied 정본의 캐시입니다. 복원·수동 DB 변경 후 불일치가 의심되면 전량 재계산하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={busy} variant="outline" size="sm">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          전량 재계산
        </Button>
        {res && (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="대상 도면" value={res.recounted} />
            <Stat label="보정된 불일치" value={res.mismatch_fixed} />
            <Stat label="Complied (ok)" value={res.ok} />
            <Stat label="미완료 (pending)" value={res.pending} />
            <Stat label="OCS 없음" value={res.none} />
            <Stat label="연결 코멘트 합계" value={res.linked_comment_total} />
            <Stat label="Complied 합계" value={res.cached_complied_total} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="tabular-nums font-semibold">{Number(value ?? 0).toLocaleString()}</div>
    </div>
  );
}