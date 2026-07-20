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
import { DatabaseBackup, Download, RotateCcw, Trash2, Lock, Unlock, CalendarClock, Play, AlertTriangle, Loader2, HardDrive } from "lucide-react";
import { BACKUP_TABLES, type BackupTableName } from "@/lib/backup/backup-core.server";
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
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
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

      <div className="flex flex-wrap items-center gap-2">
        <CreateSnapshotButton onCreated={invalidate} />
        <DownloadArchiveButton snapshots={snapshots} />
        <RestoreButton snapshots={snapshots} onRestored={invalidate} />
        <CleanupButton onCleaned={invalidate} />
      </div>

      <BackupConfigCard config={config} onUpdated={invalidate} />
      <SnapshotTable snapshots={snapshots} loading={listLoading} onChange={invalidate} />
      <LogPanel backup={logsData?.backup ?? []} restore={logsData?.restore ?? []} />
    </div>
  );
}

function CreateSnapshotButton({ onCreated }: { onCreated: () => void }) {
  const create = useServerFn(createManualSnapshot);
  const [loading, setLoading] = useState(false);

  return (
    <Button
      size="sm"
      onClick={async () => {
        setLoading(true);
        try {
          await create({ data: { name: `manual-${new Date().toISOString()}`, trigger: "manual" } });
          toast.success("스냅샷을 생성했습니다.");
          onCreated();
        } catch (err) {
          toast.error(`스냅샷 생성 실패: ${(err as Error).message}`);
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
      지금 백업
    </Button>
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
  const [tables, setTables] = useState<BackupTableName[]>(["abd_items_raw", "defect_items_raw", "task_management_raw", "spare_parts_raw", "dmr_entries"]);
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
