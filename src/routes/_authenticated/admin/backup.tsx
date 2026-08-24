import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listSnapshots,
  getBackupLogs,
  getBackupConfig,
  updateBackupConfig,
  createManualSnapshot,
  deleteSnapshot,
  lockSnapshot,
  restoreSnapshot,
  cleanupOldSnapshots,
  backupOcsMediaBatch,
  finalizeOcsMediaManifest,
  verifyOcsMedia,
} from "@/lib/backup/backup.functions";
import { BackupHelpDialog } from "@/components/admin/backup/BackupHelpDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { DatabaseBackup, Download, RotateCcw, Trash2, Lock, Unlock, CalendarClock, Play, AlertTriangle, Loader2, HardDrive, Images, ShieldCheck } from "lucide-react";
import { BACKUP_TABLES, type BackupTableName } from "@/lib/backup/backup-shared";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/backup")({
  head: () => ({ meta: [{ title: "Backup & Restore — QAIL CMS" }] }),
  component: BackupPage,
});

const QUERY_KEY = ["admin-backup"];

function bytesToHuman(bytes: number | null) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

function nextCronDate(cron: string) {
  // Very basic parser for the default '50 20 * * *'
  try {
    const parts = cron.split(" ");
    if (parts.length === 5) {
      const minute = parseInt(parts[0], 10);
      const hour = parseInt(parts[1], 10);
      // cron 시각은 UTC 기준. Doha(+03:00)로 변환해 표시한다.
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
      return next.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Qatar",
      });
    }
  } catch {
    // ignore
  }
  return "—";
}

function BackupPage() {
  const list = useServerFn(listSnapshots);
  const logs = useServerFn(getBackupLogs);
  const configFn = useServerFn(getBackupConfig);
  const qc = useQueryClient();

  const { data: snapshots = [], isLoading: listLoading } = useQuery({
    queryKey: [...QUERY_KEY, "snapshots"],
    queryFn: () => list({}),
  });
  const { data: logsData } = useQuery({
    queryKey: [...QUERY_KEY, "logs"],
    queryFn: () => logs({}),
  });
  const { data: config } = useQuery({
    queryKey: [...QUERY_KEY, "config"],
    queryFn: () => configFn({}),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...QUERY_KEY, "snapshots"] });
    qc.invalidateQueries({ queryKey: [...QUERY_KEY, "logs"] });
    qc.invalidateQueries({ queryKey: [...QUERY_KEY, "config"] });
  };

  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null);
  const totalSize = useMemo(() => snapshots.reduce((sum, s) => sum + (s.size_bytes ?? 0), 0), [snapshots]);
  const lastBackup = snapshots[0] ?? null;
  const lastLog = logsData?.backup?.[0] ?? null;


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Backup &amp; Restore</h1>
        </div>
        <BackupHelpDialog />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">다음 자동 백업</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{nextCronDate(config?.schedule_cron ?? "50 20 * * *")}</div>
            <div className="text-xs text-muted-foreground">cron: {config?.schedule_cron ?? "50 20 * * *"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <DatabaseBackup className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">마지막 백업</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">
              {lastBackup ? formatDateTime(lastBackup.created_at) : "없음"}
            </div>
            <div className="text-xs text-muted-foreground">
              {lastLog ? `상태: ${lastLog.status === "success" ? "성공" : lastLog.status === "failed" ? "실패" : "진행 중"}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <HardDrive className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">보관 스냅샷 / 용량</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{snapshots.length}개 / {bytesToHuman(totalSize)}</div>
            <div className="text-xs text-muted-foreground">Retention: {config?.retention_days ?? 30}일 / 최소 {config?.keep_minimum_count ?? 3}개</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <RotateCcw className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">마지막 복원</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">
              {logsData?.restore?.[0] ? formatDateTime(logsData.restore[0].started_at) : "없음"}
            </div>
            <div className="text-xs text-muted-foreground">
              {logsData?.restore?.[0] ? `상태: ${logsData.restore[0].status === "success" ? "성공" : "실패"}` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <OcsMediaBackupCard snapshots={snapshots} onCreated={invalidate} />

      <div className="flex flex-wrap items-center gap-2">
        <DownloadArchiveButton snapshots={snapshots} />
        <RestoreButton snapshots={snapshots} onRestored={invalidate} />
        <CleanupButton onCleaned={invalidate} onResult={setDeleteResult} />
      </div>

      <DeleteResultCard result={deleteResult} />

      <BackupConfigCard config={config} onUpdated={invalidate} />
      <SnapshotTable snapshots={snapshots} loading={listLoading} onChange={invalidate} onResult={setDeleteResult} />
      <LogPanel backup={logsData?.backup ?? []} restore={logsData?.restore ?? []} />

    </div>
  );
}

/**
 * 백업 실행 + OCS 이미지 포함 옵션(기본 OFF).
 * OFF 이면 기존 DB 백업 경로 그대로 실행된다.
 */
function OcsMediaBackupCard({ snapshots, onCreated }: { snapshots: any[]; onCreated: () => void }) {
  const create = useServerFn(createManualSnapshot);
  const mediaBatch = useServerFn(backupOcsMediaBatch);
  const finalizeMedia = useServerFn(finalizeOcsMediaManifest);
  const verifyMedia = useServerFn(verifyOcsMedia);

  const [includeMedia, setIncludeMedia] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<{ storage_path: string; error: string }[]>([]);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyTarget, setVerifyTarget] = useState<string>("");

  const runBackup = async () => {
    setLoading(true);
    setFailures([]);
    setProgress(null);
    setVerifyResult(null);
    try {
      const snap = await create({ data: { name: `manual-${new Date().toISOString()}`, trigger: "manual" } });
      if (!includeMedia) {
        toast.success("스냅샷을 생성했습니다.");
        onCreated();
        return;
      }

      let offset = 0;
      let done = 0;
      const collected: { storage_path: string; error: string }[] = [];
      // 배치 루프 — 원본 파일은 읽기 전용, 기존 백업 파일은 overwrite 하지 않음
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await mediaBatch({ data: { snapshot_id: snap.id, offset, limit: 40 } });
        done += res.processed;
        collected.push(...res.failures);
        setProgress({ done, total: res.total });
        setFailures([...collected]);
        if (res.next_offset === null) break;
        offset = res.next_offset;
      }
      const fin = await finalizeMedia({ data: { snapshot_id: snap.id } });
      setVerifyTarget(snap.id);
      toast.success(`OCS 이미지 ${fin.files}건을 백업했습니다.${collected.length ? ` 실패 ${collected.length}건` : ""}`);
      onCreated();
    } catch (err) {
      toast.error(`백업 실패: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const runVerify = async () => {
    const id = verifyTarget || snapshots[0]?.id;
    if (!id) return;
    setVerifying(true);
    try {
      const res = await verifyMedia({ data: { snapshot_id: id } });
      setVerifyResult(res);
      toast.success("이미지 ↔ DB 메타데이터 대조를 완료했습니다.");
    } catch (err) {
      toast.error(`검증 실패: ${(err as Error).message}`);
    } finally {
      setVerifying(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Images className="h-4 w-4 text-primary" />
          백업 실행
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={runBackup} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
            지금 백업
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="include-ocs-media"
              checked={includeMedia}
              onCheckedChange={(c) => setIncludeMedia(c === true)}
              disabled={loading}
            />
            <span>OCS 이미지 포함</span>
          </label>
          <Button size="sm" variant="outline" onClick={runVerify} disabled={verifying || (!verifyTarget && snapshots.length === 0)}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
            이미지 복구 검증
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          기본 OFF. 체크 시 비공개 버킷의 OCS 이미지를 배치로 함께 백업하고 media manifest(경로·attachment id·해시·크기)를 기록합니다.
        </p>

        {progress && (
          <div className="space-y-1">
            <Progress value={pct} />
            <div className="text-xs text-muted-foreground">
              이미지 {progress.done.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
            </div>
          </div>
        )}

        {failures.length > 0 && (
          <div className="rounded-md border border-destructive/40 p-2">
            <div className="text-sm font-medium text-destructive mb-1">실패 {failures.length}건</div>
            <div className="max-h-40 overflow-y-auto text-xs space-y-0.5">
              {failures.map((f) => (
                <div key={f.storage_path} className="truncate">
                  {f.storage_path} — {f.error}
                </div>
              ))}
            </div>
          </div>
        )}

        {verifyResult && (
          <div className="rounded-md border p-2 text-sm space-y-1">
            <div className="grid gap-1 sm:grid-cols-3">
              <div>DB 첨부: <b>{verifyResult.db_rows.toLocaleString()}</b></div>
              <div>manifest: <b>{verifyResult.manifest_files.toLocaleString()}</b></div>
              <div>저장 파일: <b>{verifyResult.stored_files.toLocaleString()}</b></div>
              <div>missing: <b className={verifyResult.missing_count ? "text-destructive" : ""}>{verifyResult.missing_count}</b></div>
              <div>orphan: <b className={verifyResult.orphan_count ? "text-destructive" : ""}>{verifyResult.orphan_count}</b></div>
              <div>hash mismatch: <b className={verifyResult.hash_mismatch_count ? "text-destructive" : ""}>{verifyResult.hash_mismatch_count}</b></div>
            </div>
            {[...verifyResult.missing, ...verifyResult.orphan, ...verifyResult.hash_mismatch].length > 0 && (
              <div className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
                {verifyResult.missing.map((p: string) => <div key={`m-${p}`}>missing: {p}</div>)}
                {verifyResult.orphan.map((p: string) => <div key={`o-${p}`}>orphan: {p}</div>)}
                {verifyResult.hash_mismatch.map((p: string) => <div key={`h-${p}`}>hash: {p}</div>)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DownloadArchiveButton({ snapshots }: { snapshots: any[] }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={loading || snapshots.length === 0}
      onClick={async () => {
        setLoading(true);
        try {
          const id = snapshots[0]?.id;
          if (!id) return;
          const resp = await fetch("/api/public/backup/archive-download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot_id: id }),
          });
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || "Download failed");
          }
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `qail-backup-${id}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          toast.success("백업 파일을 다운로드했습니다.");
        } catch (err) {
          toast.error(`다운로드 실패: ${(err as Error).message}`);
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Download className="h-4 w-4 mr-1.5" />}
      로컬 아카이브 저장
    </Button>
  );
}

function RestoreButton({ snapshots, onRestored }: { snapshots: any[]; onRestored: () => void }) {
  const restore = useServerFn(restoreSnapshot);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [tables, setTables] = useState<BackupTableName[]>(["abd_items_raw", "defect_items_raw", "task_management_raw", "spl_items", "spl_stage_progress", "dmr_entries"]);
  const [destructive, setDestructive] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4 mr-1.5" />
        복원
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              스냅샷 복원
            </DialogTitle>
            <DialogDescription>
              선택한 스냅샷 시점으로 데이터를 되돌립니다. 복원 전 반드시 사용자 가이드를 확인하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>스냅샷 선택</Label>
              <select
                className="w-full mt-1 border rounded-md p-2 text-sm bg-background"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">선택하세요</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatDateTime(s.created_at)}) — {s.triggered_by}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>복원할 테이블</Label>
              <div className="mt-1 grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-md p-2">
                {BACKUP_TABLES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={tables.includes(t)}
                      onCheckedChange={(checked) => {
                        setTables((prev) => (checked ? [...prev, t] : prev.filter((x) => x !== t)));
                      }}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="destructive" checked={destructive} onCheckedChange={(c) => setDestructive(c === true)} />
              <Label htmlFor="destructive" className="text-destructive font-medium">
                파괴적 복원 (Admin 전용 — 대상 테이블을 먼저 비우고 복원)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button
              variant="destructive"
              disabled={!selected || loading || tables.length === 0}
              onClick={async () => {
                setLoading(true);
                try {
                  await restore({ data: { snapshot_id: selected, tables, destructive } });
                  toast.success("복원을 완료했습니다.");
                  setOpen(false);
                  onRestored();
                } catch (err) {
                  toast.error(`복원 실패: ${(err as Error).message}`);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              복원 실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CleanupButton({ onCleaned }: { onCleaned: () => void }) {
  const cleanup = useServerFn(cleanupOldSnapshots);
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const result = await cleanup({});
          toast.success(`${result.deleted.length}개의 오래된 스냅샷을 정리했습니다.`);
          onCleaned();
        } catch (err) {
          toast.error(`정리 실패: ${(err as Error).message}`);
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
      오래된 백업 정리
    </Button>
  );
}

function BackupConfigCard({ config, onUpdated }: { config: any; onUpdated: () => void }) {
  const update = useServerFn(updateBackupConfig);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [keepMin, setKeepMin] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const currentRetention = retentionDays ?? config?.retention_days ?? 30;
  const currentKeepMin = keepMin ?? config?.keep_minimum_count ?? 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retention / 보관 설정</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>보관 기간 (일)</Label>
            <Input
              type="number"
              value={currentRetention}
              onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
              className="mt-1"
            />
          </div>
          <div>
            <Label>최소 보관 개수</Label>
            <Input
              type="number"
              value={currentKeepMin}
              onChange={(e) => setKeepMin(parseInt(e.target.value, 10))}
              className="mt-1"
            />
          </div>
        </div>
        <Button
          size="sm"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await update({ data: { retention_days: currentRetention, keep_minimum_count: currentKeepMin } });
              toast.success("설정을 저장했습니다.");
              onUpdated();
            } catch (err) {
              toast.error(`저장 실패: ${(err as Error).message}`);
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          저장
        </Button>
      </CardContent>
    </Card>
  );
}

function SnapshotTable({ snapshots, loading, onChange }: { snapshots: any[]; loading: boolean; onChange: () => void }) {
  const del = useServerFn(deleteSnapshot);
  const lock = useServerFn(lockSnapshot);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">스냅샷 목록</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>시점</TableHead>
              <TableHead>트리거</TableHead>
              <TableHead>크기</TableHead>
              <TableHead>테이블 수</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">불러오는 중…</TableCell>
              </TableRow>
            ) : snapshots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">스냅샷이 없습니다.</TableCell>
              </TableRow>
            ) : (
              snapshots.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{formatDateTime(s.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant={s.triggered_by === "scheduled" ? "default" : s.triggered_by === "pre-import" ? "secondary" : "outline"}>
                      {s.triggered_by}
                    </Badge>
                  </TableCell>
                  <TableCell>{bytesToHuman(s.size_bytes)}</TableCell>
                  <TableCell>{(s.tables_included ?? []).length}</TableCell>
                  <TableCell>
                    {s.is_locked ? (
                      <Badge variant="outline"><Lock className="h-3 w-3 mr-1" /> 잠금</Badge>
                    ) : (
                      <Badge variant="outline">보관 중</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={async () => {
                          try {
                            await lock({ data: { snapshot_id: s.id, is_locked: !s.is_locked } });
                            toast.success(s.is_locked ? "잠금을 해제했습니다." : "스냅샷을 잠금 처리했습니다.");
                            onChange();
                          } catch (err) {
                            toast.error(`잠금 변경 실패: ${(err as Error).message}`);
                          }
                        }}
                      >
                        {s.is_locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>스냅샷 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 스냅샷을 Storage에서 완전히 삭제합니다. 복원에 필요한 파일이 함께 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteId) return;
                try {
                  await del({ data: { snapshot_id: deleteId } });
                  toast.success("스냅샷을 삭제했습니다.");
                  setDeleteId(null);
                  onChange();
                } catch (err) {
                  toast.error(`삭제 실패: ${(err as Error).message}`);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LogPanel({ backup, restore }: { backup: any[]; restore: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">최근 실행 로그</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="text-sm font-medium mb-2">백업 로그</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시작</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>소요(ms)</TableHead>
                <TableHead>오류</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backup.slice(0, 10).map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDateTime(log.started_at)}</TableCell>
                  <TableCell>
                    <Badge variant={log.status === "success" ? "default" : log.status === "failed" ? "destructive" : "outline"}>
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{log.duration_ms ?? "—"}</TableCell>
                  <TableCell className="text-destructive text-xs">{log.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <h4 className="text-sm font-medium mb-2">복원 로그</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시작</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>소요(ms)</TableHead>
                <TableHead>오류</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {restore.slice(0, 10).map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDateTime(log.started_at)}</TableCell>
                  <TableCell>
                    <Badge variant={log.status === "success" ? "default" : log.status === "failed" ? "destructive" : "outline"}>
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{log.duration_ms ?? "—"}</TableCell>
                  <TableCell className="text-destructive text-xs">{log.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
