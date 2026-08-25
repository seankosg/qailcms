/**
 * 안전 복원 Wizard (Holding Point 4)
 *
 * - System Administrator 에게만 노출된다.
 * - HP2/HP3 안전 관문(사전검증 → 준비 영역 → 지문 고정 → 안전 스냅샷 → 원자적 반영)을 그대로 따른다.
 * - 레거시 복원 경로는 되살리지 않는다.
 * - 서버 run 상태가 최종 정본이며, 브라우저 state 만으로 실행 여부를 판단하지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listRestoreScopes,
  startRestorePreflight,
  stageRestoreRun,
  verifyRestoreStaging,
} from "@/lib/backup/backup.functions";
import {
  pinRestoreStagingDigest,
  createRestoreSafetySnapshot,
  applySafeRestore,
  getRestoreRunStatus,
} from "@/lib/backup/safe-restore.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, RotateCcw, ShieldCheck, Copy } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import {
  classifyApplyResponse,
  classifyApplyThrow,
  deriveWizardState,
  isConfirmedRollback,
  type RestoreRunStatusView,
} from "@/lib/backup/safe-restore-ui";

const RUN_STORAGE_KEY = "qail.safe-restore.run_id";

type Snapshot = {
  id: string;
  name: string | null;
  created_at: string | null;
  size_bytes: number | null;
  status?: string | null;
  metadata?: any;
  tables_included?: string[] | null;
};

function bytes(n: number | null | undefined) {
  if (!n) return "-";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let s = n;
  while (s >= 1024 && i < u.length - 1) {
    s /= 1024;
    i++;
  }
  return `${s.toFixed(2)} ${u[i]}`;
}

function schemaVersionOf(s: Snapshot | null | undefined): string | null {
  return (s?.metadata?.schema_version as string | undefined) ?? null;
}

function isSelectable(s: Snapshot) {
  const v = schemaVersionOf(s);
  const st = (s.status ?? "").toLowerCase();
  if (st && !["success", "completed", "ok"].includes(st)) return false;
  return v === "qail-snapshot-v2";
}

function elapsed(from: number | null) {
  if (!from) return "0s";
  const sec = Math.floor((Date.now() - from) / 1000);
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function SafeRestoreWizard({ snapshots }: { snapshots: Snapshot[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4 mr-1.5" />
        안전 복원
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              안전 복원 (System Administrator 전용)
            </DialogTitle>
            <DialogDescription>
              사전검증 → 준비 영역 검산 → 안전 스냅샷 → 단일 트랜잭션 반영 순서로만 진행됩니다.
            </DialogDescription>
          </DialogHeader>
          <WizardBody snapshots={snapshots} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function WizardBody({ snapshots }: { snapshots: Snapshot[] }) {
  const scopesFn = useServerFn(listRestoreScopes);
  const preflightFn = useServerFn(startRestorePreflight);
  const stageFn = useServerFn(stageRestoreRun);
  const verifyFn = useServerFn(verifyRestoreStaging);
  const pinFn = useServerFn(pinRestoreStagingDigest);
  const safetyFn = useServerFn(createRestoreSafetySnapshot);
  const applyFn = useServerFn(applySafeRestore);
  const statusFn = useServerFn(getRestoreRunStatus);

  const { data: scopes = [] } = useQuery({
    queryKey: ["safe-restore", "scopes"],
    queryFn: () => scopesFn({}),
  });

  const [snapshotId, setSnapshotId] = useState("");
  const [scope, setScope] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [staged, setStaged] = useState<any>(null);
  const [verify, setVerify] = useState<any>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [digestTables, setDigestTables] = useState<{ table: string; rows: number }[]>([]);
  const [safety, setSafety] = useState<any>(null);
  const [ackOthers, setAckOthers] = useState(false);
  const [ackStay, setAckStay] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<any>(null);
  const [failure, setFailure] = useState<{ kind: "rollback" | "unknown"; code: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const [serverStatus, setServerStatus] = useState<RestoreRunStatusView | null>(null);
  const [recheckedInSession, setRecheckedInSession] = useState(false);

  const lock = useRef(false);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  /** 서버 run 상태를 정본으로 삼아 Wizard 단계 데이터를 재구성한다. */
  function hydrateFromServer(s: any) {
    setServerStatus(s as RestoreRunStatusView);
    setScope(s.requested_scope ?? "");
    setSnapshotId(s.snapshot_id ?? "");
    setPreflight({
      run_id: s.run_id,
      preflight: {
        blockers: s.preflight_summary?.blockers ?? [],
        warnings: s.preflight_summary?.warnings ?? [],
        expected_rows: s.expected_rows ?? {},
        // 렌더링 계약과 동일한 위치에 저장한다(preflight.preflight.dependency).
        dependency: {
          final_restore_tables: s.final_restore_tables ?? [],
          auto_included_tables: s.auto_included_tables ?? [],
          keep_current_parent_tables: s.keep_current_parent_tables ?? [],
          required_parent_tables: s.required_parent_tables ?? [],
        },
      },
    });

    if (s.staged_rows && Object.keys(s.staged_rows).length > 0) setStaged({ staged_rows: s.staged_rows });
    if (s.staging_verify) setVerify(s.staging_verify);
    if (s.staging_overall_digest) setDigest(s.staging_overall_digest);
    if (s.safety_snapshot_id) setSafety({ safety_snapshot_id: s.safety_snapshot_id, is_locked: true });
    if (s.status === "success") setResult(s.apply_result ?? { ok: true });
    else if (s.status === "apply_failed" && isConfirmedRollback(s)) {
      setFailure({ kind: "rollback", code: s.error_code ?? "RESTORE_APPLY_FAILED", message: s.error_message ?? "" });
    } else if (s.status === "applying") {
      setFailure({ kind: "unknown", code: "RESTORE_APPLY_IN_PROGRESS", message: "복원 결과가 확정되지 않았습니다." });
    }
  }

  // 새로고침 복구: 남아 있는 run 은 상태 조회만 수행한다(자동 재실행 없음).
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(RUN_STORAGE_KEY) : null;
    if (!saved) return;
    setRunId(saved);
    statusFn({ data: { run_id: saved } })
      .then((s) => hydrateFromServer(s))
      .catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetWizard() {
    if (typeof window !== "undefined") window.localStorage.removeItem(RUN_STORAGE_KEY);
    setRunId(null);
    setSnapshotId("");
    setScope("");
    setPreflight(null);
    setStaged(null);
    setVerify(null);
    setDigest(null);
    setDigestTables([]);
    setSafety(null);
    setAckOthers(false);
    setAckStay(false);
    setConfirmation("");
    setResult(null);
    setFailure(null);
    setServerStatus(null);
    setRecheckedInSession(false);
  }

  const selectedSnapshot = useMemo(
    () => snapshots.find((s) => s.id === snapshotId) ?? null,
    [snapshots, snapshotId],
  );
  const scopeTables = useMemo(
    () => (scopes as any[]).find((s) => s.key === scope)?.tables ?? [],
    [scopes, scope],
  );

  const blockers: any[] = preflight?.preflight?.blockers ?? preflight?.blockers ?? [];
  const dependency = preflight?.preflight?.dependency ?? null;
  const expectedRows: Record<string, number> = preflight?.preflight?.expected_rows ?? {};

  const wizard = deriveWizardState(serverStatus, { recheckedInSession });
  const unresolved = failure?.kind === "unknown" || wizard.unresolved;
  const canStartNew = !!serverStatus && wizard.canStartNew && !unresolved;

  const expectedConfirmation = runId && scope ? `RESTORE ${scope} ${runId.slice(0, 8)}` : "";

  async function guarded(key: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    setStartedAt(Date.now());
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message ?? "실패했습니다.");
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const doPreflight = () =>
    guarded("preflight", async () => {
      const res: any = await preflightFn({ data: { snapshot_id: snapshotId, scope } });
      setPreflight(res);
      setRunId(res.run_id);
      window.localStorage.setItem(RUN_STORAGE_KEY, res.run_id);
      setStaged(null);
      setVerify(null);
      setDigest(null);
      setSafety(null);
      setResult(null);
      setFailure(null);
      setServerStatus(null);
    });

  const doStage = () =>
    guarded("stage", async () => {
      const st: any = await stageFn({ data: { run_id: runId! } });
      setStaged(st);
      const vf: any = await verifyFn({ data: { run_id: runId! } });
      setVerify(vf);
      if (vf?.ok) {
        const pinned: any = await pinFn({ data: { run_id: runId! } });
        setDigest(pinned.overall_digest);
        setDigestTables(pinned.tables ?? []);
      }
    });

  const doSafety = () =>
    guarded("safety", async () => {
      const s: any = await safetyFn({
        data: { run_id: runId!, expected_overall_digest: digest! },
      });
      setSafety(s);
    });

  const doApply = () =>
    guarded("apply", async () => {
      // 브라우저 예외는 DB 트랜잭션 결과를 증명하지 못한다 → 항상 미확정 처리.
      try {
        const res: any = await applyFn({
          data: { run_id: runId!, expected_overall_digest: digest!, confirmation },
        });
        const verdict = classifyApplyResponse(res);
        if (verdict.kind === "success") {
          setResult(res);
        } else {
          setFailure({ kind: "unknown", code: verdict.code!, message: verdict.message! });
        }
      } catch (err) {
        const verdict = classifyApplyThrow(err);
        setFailure({ kind: "unknown", code: verdict.code, message: verdict.message });
      }
    });

  const recheck = () =>
    guarded("recheck", async () => {
      const s: any = await statusFn({ data: { run_id: runId! } });
      setServerStatus(s);
      setRecheckedInSession(true);
      if (s.status === "success") {
        setResult(s.apply_result ?? { ok: true });
        setFailure(null);
      } else if (s.status === "apply_failed" && isConfirmedRollback(s)) {
        // 「롤백 확정」 표시는 서버 기록이 apply_failed + 오류 기록일 때만 허용한다.
        setFailure({ kind: "rollback", code: s.error_code ?? "RESTORE_APPLY_FAILED", message: s.error_message ?? "" });
      }
    });

  const step1Ok = !!snapshotId && !!scope && !unresolved;
  const step2Ok = !!preflight && blockers.length === 0;
  const step3Ok = verify?.ok === true && !!digest;
  const step4Ok = !!safety?.safety_snapshot_id;
  const serverBlocksApply = !!serverStatus && !wizard.allowApply;
  const step5Ok =
    step4Ok && confirmation.trim() === expectedConfirmation && !unresolved && !serverBlocksApply;

  return (
    <div className="space-y-5 py-1">
      {unresolved && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">복원 결과 확인 필요</div>
          <div>결과가 확정될 때까지 새 복원을 시작할 수 없습니다.</div>
        </div>
      )}

      {wizard.notice && !unresolved && (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">{wizard.notice}</div>
      )}

      {canStartNew && (
        <div className="flex items-center justify-between rounded-md border p-3 text-xs">
          <span>이 복원 작업은 종료되었습니다. 기존 기록·로그·Snapshot 은 그대로 보존됩니다.</span>
          <Button size="sm" variant="outline" onClick={resetWizard}>
            새 안전 복원 시작
          </Button>
        </div>
      )}

      {/* Step 1 */}
      <section className="rounded-md border p-3 space-y-3">
        <h3 className="text-sm font-semibold">1. 백업과 복원 범위 선택</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>백업(Snapshot)</Label>
            <select
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
              disabled={!!runId || unresolved}
            >
              <option value="">선택하십시오</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id} disabled={!isSelectable(s)}>
                  {s.name ?? s.id.slice(0, 8)} · {formatDateTime(s.created_at)} ·{" "}
                  {schemaVersionOf(s) ?? "규격 불명"} {isSelectable(s) ? "" : "(선택 불가)"}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>복원 범위</Label>
            <select
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={!!runId || unresolved}
            >
              <option value="">선택하십시오</option>
              {(scopes as any[]).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} ({s.tables.length}개 표)
                </option>
              ))}
            </select>
          </div>
        </div>
        {selectedSnapshot && (
          <div className="text-xs text-muted-foreground">
            규격 {schemaVersionOf(selectedSnapshot) ?? "—"} · 크기 {bytes(selectedSnapshot.size_bytes)} · 포함 표{" "}
            {selectedSnapshot.tables_included?.length ?? 0}개 · 범위 표 {scopeTables.length}개
          </div>
        )}
        <Button size="sm" disabled={!step1Ok || busy === "preflight" || !!runId} onClick={doPreflight}>
          {busy === "preflight" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          1. 복원 가능 여부 확인 — 데이터 변경 없음
        </Button>
      </section>

      {/* Step 2 */}
      {preflight && (
        <section className="rounded-md border p-3 space-y-2">
          <h3 className="text-sm font-semibold">2. 사전검증 결과</h3>
          <div className="text-xs">Restore run ID: <code>{runId}</code></div>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div>자동 포함 표: {(dependency?.auto_included_tables ?? []).join(", ") || "—"}</div>
            <div>현재값 유지 부모 표: {(dependency?.keep_current_parent_tables ?? []).join(", ") || "—"}</div>
            <div className="sm:col-span-2">
              복원 대상 표: {(dependency?.final_restore_tables ?? []).join(", ") || "—"}
            </div>
            <div className="sm:col-span-2">
              예상 행수:{" "}
              {Object.entries(expectedRows)
                .map(([t, n]) => `${t}=${n}`)
                .join(", ") || "—"}
            </div>
          </div>
          {blockers.length > 0 ? (
            <div className="rounded border border-destructive/50 bg-destructive/5 p-2 text-xs">
              <div className="font-medium text-destructive">차단 사유 {blockers.length}건 — 이후 단계가 잠깁니다.</div>
              <ul className="list-disc pl-4">
                {blockers.map((b, i) => (
                  <li key={i}>{b.code}: {b.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Badge variant="secondary">차단 사유 없음</Badge>
          )}
        </section>
      )}

      {/* Step 3 */}
      {step2Ok && (
        <section className="rounded-md border p-3 space-y-2">
          <h3 className="text-sm font-semibold">3. 준비 영역 적재 및 검산</h3>
          <p className="text-xs text-muted-foreground">
            준비 영역에만 적재합니다. 운영 데이터는 아직 변경되지 않았습니다.
          </p>
          <Button size="sm" disabled={busy === "stage" || step3Ok} onClick={doStage}>
            {busy === "stage" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            3. 준비 영역 적재 및 검산
          </Button>
          {staged && (
            <div className="text-xs">
              적재 행수:{" "}
              {Object.entries(staged.staged_rows ?? {})
                .map(([t, n]) => `${t}=${n}`)
                .join(", ")}
            </div>
          )}
          {verify && (
            <div className="text-xs">
              검산 결과: {verify.ok ? "정상" : `실패 (${(verify.issues ?? []).map((i: any) => i.code).join(", ")})`}
            </div>
          )}
          {digest && (
            <div className="text-xs flex items-center gap-2">
              고정 지문: <code>{digest.slice(0, 16)}…</code>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(digest)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Step 4 */}
      {step3Ok && (
        <section className="rounded-md border p-3 space-y-2">
          <h3 className="text-sm font-semibold">4. 복원 직전 안전 스냅샷</h3>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ackOthers} onCheckedChange={(v) => setAckOthers(v === true)} disabled={step4Ok} />
            <span>현재 다른 사용자가 데이터를 저장하거나 Import하고 있지 않음을 확인했습니다.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ackStay} onCheckedChange={(v) => setAckStay(v === true)} disabled={step4Ok} />
            <span>복원 완료까지 이 화면을 닫거나 새로고침하지 않겠습니다.</span>
          </label>
          <p className="text-[11px] text-muted-foreground">
            이 확인은 운영 절차이며 다른 사용자의 저장을 기술적으로 차단하지 않습니다.
          </p>
          <Button
            size="sm"
            disabled={!ackOthers || !ackStay || busy === "safety" || step4Ok}
            onClick={doSafety}
          >
            {busy === "safety" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            4. 복원 직전 안전 스냅샷 생성
          </Button>
          {busy === "safety" && (
            <div className="text-xs text-muted-foreground">
              <Progress value={undefined} className="h-1 my-1" />
              경과 {elapsed(startedAt)} · 대상 표 {(dependency?.final_restore_tables ?? []).length}개 · Restore run {runId?.slice(0, 8)}
            </div>
          )}
          {safety && (
            <div className="text-xs">
              안전 스냅샷 <code>{safety.safety_snapshot_id}</code> · 생성 {formatDateTime(safety.created_at)} · 잠금{" "}
              {safety.is_locked ? "예" : "아니오"} · 결속 run <code>{runId?.slice(0, 8)}</code>
            </div>
          )}
        </section>
      )}

      {/* Step 5 */}
      {step4Ok && !result && !failure && (
        <section className="rounded-md border p-3 space-y-2">
          <h3 className="text-sm font-semibold">5. 최종 검토</h3>
          <div className="grid gap-1 text-xs">
            <div>원본 Snapshot: <code>{snapshotId}</code></div>
            <div>Safety Snapshot: <code>{safety.safety_snapshot_id}</code></div>
            <div>Scope: {scope}</div>
            <div>삭제 후 재적재 표: {(dependency?.final_restore_tables ?? []).join(", ")}</div>
            <div>자동 포함 표: {(dependency?.auto_included_tables ?? []).join(", ") || "—"}</div>
            <div>
              표별 예상 행수: {digestTables.map((t) => `${t.table}=${t.rows}`).join(", ") || "—"}
            </div>
            <div className="flex items-center gap-2">
              staging digest: <code>{digest?.slice(0, 16)}…</code>
              <Button variant="ghost" size="sm" onClick={() => digest && navigator.clipboard.writeText(digest)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div>복원 후 검산: 행수 대조 · 정규화 지문 대조 · 범위 밖 보호 표 불변 확인 · 시퀀스 재조정</div>
            <div>복원 범위 밖 데이터는 변경하지 않습니다.</div>
          </div>
          <div className="rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
            이 작업은 선택한 범위의 현재 데이터를 백업 시점으로 되돌립니다. 복원 시작 후에는 취소할 수 없습니다.
          </div>
          <div className="space-y-1">
            <Label className="text-xs">확인 문자열 입력: <code>{expectedConfirmation}</code></Label>
            <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={expectedConfirmation} />
          </div>
          <Button size="sm" variant="destructive" disabled={!step5Ok || busy === "apply"} onClick={doApply}>
            {busy === "apply" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            5. 안전 복원 실행
          </Button>
        </section>
      )}

      {/* Step 6 */}
      {busy === "apply" && (
        <section className="rounded-md border p-3 space-y-1 text-xs">
          <Progress value={undefined} className="h-1" />
          <div>복원 반영 중 · 경과 {elapsed(startedAt)} · restore run <code>{runId}</code></div>
          <div className="text-destructive font-medium">새로고침·창 닫기·복원 재실행 금지</div>
        </section>
      )}

      {result && (
        <section className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-1 text-xs">
          <div className="text-sm font-semibold text-primary">복원 완료</div>
          <div>run ID: <code>{runId}</code></div>
          <div>source snapshot: <code>{snapshotId || serverStatus?.snapshot_id}</code></div>
          <div>safety snapshot: <code>{safety?.safety_snapshot_id ?? serverStatus?.safety_snapshot_id}</code></div>
          <div>
            반영 표·행수:{" "}
            {(result.tables ?? []).map((t: any) => `${t.table}=${t.rows ?? "-"}`).join(", ") || "—"}
          </div>
          <div>사후 지문·행수 검산: 통과 (반영 트랜잭션 내 검산)</div>
          <div>범위 밖 보호 표 불변: {(result.guard_tables ?? []).join(", ") || "—"}</div>
        </section>
      )}

      {failure?.kind === "rollback" && (
        <section className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1 text-xs">
          <div className="text-sm font-semibold text-destructive">복원 실패 — 트랜잭션 전체 롤백 확인</div>
          <div>오류 코드: <code>{failure.code}</code></div>
          <div className="break-all">{failure.message}</div>
          <div>재실행하지 말고 새 사전검증(1단계)부터 다시 시작하십시오.</div>
        </section>
      )}

      {failure?.kind === "unknown" && (
        <section className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2 text-xs">
          <div className="text-sm font-semibold text-destructive">복원 결과 확인 필요</div>
          <div className="text-base font-mono break-all">{runId}</div>
          <div className="font-medium text-destructive">복원을 다시 실행하지 마십시오.</div>
          <div className="break-all">{failure.message}</div>
          <Button size="sm" variant="outline" disabled={busy === "recheck"} onClick={recheck}>
            {busy === "recheck" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            현재 상태 다시 확인
          </Button>
        </section>
      )}

      {serverStatus && !result && !failure && (
        <section className="rounded-md border p-3 text-xs space-y-1">
          <div className="font-medium">서버 기록 상태</div>
          <div>run <code>{serverStatus.run_id}</code> · status {serverStatus.status}</div>
          {serverStatus.error_code && <div>오류: {serverStatus.error_code}</div>}
          <Button size="sm" variant="outline" disabled={busy === "recheck"} onClick={recheck}>
            현재 상태 다시 확인
          </Button>
        </section>
      )}
    </div>
  );
}
