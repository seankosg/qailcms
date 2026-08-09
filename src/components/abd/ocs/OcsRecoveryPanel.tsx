import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, LifeBuoy } from "lucide-react";
import {
  ocsRecover20260809DryRun,
  ocsRecover20260809Run,
} from "@/lib/abd/ocs-recover-20260809.functions";

/**
 * 2026-08-09 부분 반영 사고 전용 복구 패널 (admin 전용 유지보수 화면에만 노출).
 * 일반 사용자용 반복 실행 경로가 아니며, 복구 완료 후 제거 대상이다.
 */
export function OcsRecoveryPanel() {
  const dryRun = useServerFn(ocsRecover20260809DryRun);
  const run = useServerFn(ocsRecover20260809Run);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState("");

  const onDryRun = async () => {
    setBusy(true);
    try {
      setOut(JSON.stringify(await dryRun({}), null, 2));
      toast.success("복구 Dry-run 완료 (변경 없음)");
    } catch (e) {
      toast.error(`Dry-run 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!snapshotId.trim()) {
      toast.error("사전 백업 스냅샷 ID 를 입력하십시오.");
      return;
    }
    setBusy(true);
    try {
      setOut(JSON.stringify(await run({ data: { snapshot_id: snapshotId.trim() } }), null, 2));
      toast.success("복구 완료");
    } catch (e) {
      toast.error(`복구 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="h-4 w-4" /> OCS 부분 반영 복구 (2026-08-09 일회성)
        </CardTitle>
        <CardDescription>
          원본 Import 로그 <code>b558b4bb…</code> 의 누락분(comments · ABD links · attachment links ·
          response links)만 멱등 복구합니다. 기존 행 삭제·스냅샷 복원·파일 재업로드는 하지 않으며,
          사전조건 수치가 정확히 일치할 때만 실행됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onDryRun} disabled={busy} variant="outline" size="sm">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}복구 Dry-run
          </Button>
          <Input
            value={snapshotId}
            onChange={(e) => setSnapshotId(e.target.value)}
            placeholder="사전 백업 스냅샷 ID"
            className="h-8 w-[22rem]"
          />
          <Button onClick={onRun} disabled={busy || !snapshotId.trim()} size="sm">
            복구 실행
          </Button>
        </div>
        {out && (
          <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            {out}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
