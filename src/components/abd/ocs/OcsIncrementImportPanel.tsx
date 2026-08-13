import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, Loader2, PackageOpen, ShieldCheck } from "lucide-react";
import { FilePickerButton } from "@/components/shared/FilePickerButton";
import { supabase } from "@/integrations/supabase/client";
import { chunk } from "@/lib/abd/ocs-db-parser";
import { readIncrementPackage, type IncrementPackage } from "@/lib/abd/ocs-increment-package";
import {
  checkPackageStorageCollisions,
  imageStoragePath,
  sourceStoragePath,
  type CollisionReport,
} from "@/lib/abd/ocs-storage-collision";
import {
  ocsV3StageLoad,
  ocsV3StageReset,
  type V3StageKind,
} from "@/lib/abd/ocs-v3-import.functions";
import { ocsIncDryRun, ocsIncImport, ocsIncPrecheck } from "@/lib/abd/ocs-increment.functions";
import { ocsIncVerifyBatch } from "@/lib/abd/ocs-increment-verify.functions";
import { VERIFY_BATCH_MAX } from "@/lib/abd/ocs-increment-verify";
import { OcsBaselineCard } from "@/components/abd/ocs/OcsBaselineCard";
import { getLatestOcsBaselineInfo } from "@/lib/abd/ocs-baseline.functions";
import { ocsIncListVerifyReceipts } from "@/lib/abd/ocs-increment-receipts.functions";
import {
  classifyImportFailure,
  evaluateGates,
  evaluateImportSuccess,
  type GateInput,
  type ImportFailureState,
} from "@/lib/abd/ocs-wizard-gates";
import {
  OcsWizardStepper,
  type StepStatus,
  type WizardStep,
} from "@/components/abd/ocs/wizard/OcsWizardStepper";
import { OcsWizardStepCard } from "@/components/abd/ocs/wizard/OcsWizardStepCard";
import { OcsErrorCard } from "@/components/abd/ocs/wizard/OcsErrorCard";

/** 기존 running 백업 감시 제한 시간(20분). 초과해도 실패로 단정하지 않는다. */
const SNAPSHOT_WATCH_TIMEOUT_MS = 20 * 60 * 1000;
import {
  CheckItem,
  OcsResponsibilityCard,
  Step2PrepareFiles,
  Step3BuildPackage,
} from "@/components/abd/ocs/wizard/OcsPreparationSteps";
import { OcsLocalValidationCard } from "@/components/abd/ocs/wizard/OcsLocalValidationCard";
import type { LocalValidationReceipt } from "@/lib/abd/ocs-local-validation";
import { Copy, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createPreImportSnapshot, getBackupRunStatus } from "@/lib/backup/backup.functions";
import { OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import { OCS_SOURCE_BUCKET } from "@/lib/abd/ocs-source-manifest";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessAbdOcs } from "@/lib/abd/ocs-access";
import type { UploadReceipt } from "@/lib/abd/ocs-increment-types";

const BATCH = 500;
const UPLOAD_CONCURRENCY = 5;
const RETIRE_PCT = 0.3;
const RETIRE_ABS = 100;
/**
 * Stage 9 — 실제 admin 세션에서 Baseline ZIP 생성·다운로드·내용 검증이
 * 완료되었으므로 true로 유지한다.
 */
const BASELINE_VERIFICATION_IMPLEMENTED = true;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

type Dry = Record<string, unknown>;

function Row({ label, value, bad }: { label: string; value: unknown; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${bad ? "font-semibold text-destructive" : ""}`}>
        {String(value ?? "—")}
      </span>
    </div>
  );
}

export function OcsIncrementImportPanel() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const stageReset = useServerFn(ocsV3StageReset);
  const stageLoad = useServerFn(ocsV3StageLoad);
  const precheckFn = useServerFn(ocsIncPrecheck);
  const dryRunFn = useServerFn(ocsIncDryRun);
  const importFn = useServerFn(ocsIncImport);
  const verifyFn = useServerFn(ocsIncVerifyBatch);
  const snapshotFn = useServerFn(createPreImportSnapshot);
  const snapshotStatusFn = useServerFn(getBackupRunStatus);
  const baselineInfoFn = useServerFn(getLatestOcsBaselineInfo);
  const listVerifyReceiptsFn = useServerFn(ocsIncListVerifyReceipts);

  const [pkg, setPkg] = useState<IncrementPackage | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  // 브라우저 로컬 검증 결과 — null 이면 미실행. clean 이 아니면 서버 단계로 진행하지 않는다.
  const [localValid, setLocalValid] = useState<{
    clean: boolean | null;
    blockerCount: number;
    receipt?: LocalValidationReceipt | null;
  }>({ clean: null, blockerCount: 0, receipt: null });
  const [precheck, setPrecheck] = useState<Record<string, unknown> | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dry, setDry] = useState<Dry | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [backupRunId, setBackupRunId] = useState<string | null>(null);
  // React state 는 비동기 배칭되므로 더블클릭을 막지 못한다. 동기 ref 잠금을 함께 둔다.
  const snapshotLockRef = useRef(false);
  const [snapshotRunning, setSnapshotRunning] = useState(false);
  /** 서버가 already_running 을 반환했거나 기존 run 에 합류했을 때 3초 주기로 감시할 backup run ID */
  const [watchRunId, setWatchRunId] = useState<string | null>(null);
  /** 감시 시간 초과 — 실패로 단정하지 않고 "상태 확인 필요" 로만 표시한다. */
  const [snapshotStale, setSnapshotStale] = useState(false);
  const snapshotTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [snapshotElapsed, setSnapshotElapsed] = useState(0);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<{
    tablesTotal: number;
    tablesDone: number;
    currentTable: string | null;
    sizeBytes: number | null;
  } | null>(null);
  const [importRunning, setImportRunning] = useState(false);
  const [importElapsed, setImportElapsed] = useState(0);
  const [importFailStage, setImportFailStage] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [allowRetire, setAllowRetire] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [importFailure, setImportFailure] = useState<ImportFailureState | null>(null);
  const [collision, setCollision] = useState<CollisionReport | null>(null);
  const [receipts, setReceipts] = useState<UploadReceipt[]>([]);
  const [verifyTotal, setVerifyTotal] = useState(0);
  const [verifyOk, setVerifyOk] = useState<string[]>([]);
  const [verifyFailures, setVerifyFailures] = useState<{ path: string; error: string }[]>([]);
  const [verifyRan, setVerifyRan] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  // ── Wizard 로컬 진행 상태 (사용자 확인 기록 · 서버 판정에는 영향 없음) ──
  const PREP_KEY = "abd.ocs.wizard.prep.v1";
  const [prepChecks, setPrepChecks] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [baselineConfirmed, setBaselineConfirmed] = useState(false);
  const [packageBuilt, setPackageBuilt] = useState(false);
  const [skipPreparation, setSkipPreparation] = useState(false);
  const [openStep, setOpenStep] = useState(1);
  const [baselineInfo, setBaselineInfo] = useState<{
    exists: boolean;
    baseline_id: string;
    generated_at: string | null;
    data_date: string | null;
    zip_byte_size: number | null;
    total_rows: number | null;
    files: { name: string; byte_size: number; row_count: number | null }[];
    is_latest: boolean;
  } | null>(null);
  const [baselineInfoError, setBaselineInfoError] = useState<string | null>(null);
  const [restoredVerify, setRestoredVerify] = useState<string | null>(null);

  // 새로고침 복원 — 로컬 확인 체크는 브라우저에, 서버 사실은 서버에서만 복원한다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREP_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(s["checks"]))
        setPrepChecks([s["checks"][0] === true, s["checks"][1] === true, s["checks"][2] === true]);
      setBaselineConfirmed(s["baselineConfirmed"] === true);
      setPackageBuilt(s["packageBuilt"] === true);
      setSkipPreparation(s["skipPreparation"] === true);
    } catch {
      /* 저장 형식 오류는 무시하고 초기 상태로 시작한다 */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        PREP_KEY,
        JSON.stringify({
          checks: prepChecks,
          baselineConfirmed,
          packageBuilt,
          skipPreparation,
        }),
      );
    } catch {
      /* 저장 실패는 진행에 영향 없음 */
    }
  }, [prepChecks, baselineConfirmed, packageBuilt, skipPreparation]);

  // Step 1 — 최신 Baseline 메타데이터 서버 복원 (읽기 전용)
  useEffect(() => {
    if (!isAdminRef.current) return;
    void (async () => {
      try {
        const info = (await baselineInfoFn()) as typeof baselineInfo;
        setBaselineInfo(info);
        setBaselineInfoError(null);
      } catch (e) {
        setBaselineInfoError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.isStrictAdmin, me?.userType, me?.team]);

  // ABD OCS 관리 권한 = admin 또는 HDEC PIC(Team DESN). 관리자와 동일 기능 전부 허용.
  const isAdmin = canAccessAbdOcs({
    userType: me?.userType,
    team: me?.team,
    isStrictAdmin: me?.isStrictAdmin,
  });
  const isAdminRef = useRef(false);
  isAdminRef.current = isAdmin;

  const retire = num(dry?.["comments_to_retire"]);
  const scopeActive = num(dry?.["scope_existing_active"]);
  const massRetire = dry ? retire > scopeActive * RETIRE_PCT || retire > RETIRE_ABS : false;

  /** 서버 검증이 필요한 전체 신규 asset 수 (기존 동일 hash skip 제외) — 성공 receipt 수와 무관하게 고정. */
  const newAssetTotal = useMemo(() => {
    if (!pkg) return 0;
    const skip = collision?.skipPaths ?? new Set<string>();
    const paths = [
      ...pkg.images.map((b) => imageStoragePath(b.relative_path)),
      ...pkg.sourceFiles.map((b) => sourceStoragePath(pkg.manifest.package_id, b.relative_path)),
    ];
    return paths.filter((p) => !skip.has(p)).length;
  }, [pkg, collision]);

  const uploadFailures = useMemo(() => receipts.filter((r) => r.state === "failed"), [receipts]);
  const uploadFailedCount = uploadFailures.length;

  // Baseline 동일성 — 4개 값이 모두 일치하면 "마지막 Import 이후 변경" 은 경고로만 취급한다.
  const baselineIdentityOk = useMemo(() => {
    if (!precheck || !pkg) return false;
    const base = (precheck["baseline"] ?? {}) as Record<string, unknown>;
    const mismatched = Array.isArray(precheck["mismatched_core_tables"])
      ? (precheck["mismatched_core_tables"] as string[])
      : [];
    return (
      precheck["baseline_id_match"] === true &&
      precheck["base_core_hash_match"] === true &&
      mismatched.length === 0 &&
      String(pkg.manifest.base_import_run_id ?? "") ===
        String(base["latest_success_import_run_id"] ?? "")
    );
  }, [precheck, pkg]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    const base = (precheck?.["baseline"] ?? {}) as Record<string, unknown>;
    if (precheck && base["core_changed_since_base"] === true && baselineIdentityOk) {
      out.push(
        "경고: 마지막 Import 이후 OCS 정본에 변경 이력이 있으나, Baseline ID·core hash·테이블별 해시·latest import run 이 모두 일치하여 통과 처리합니다.",
      );
    }
    return out;
  }, [precheck, baselineIdentityOk]);

  // ── 구조화된 blocker 그룹 · 단계 관문 (문구 정규식 판정 금지) ──
  const duplicatePackage = precheck?.["duplicate_package"] === true;
  const duplicateRecovered = precheck?.["duplicate_recovered"] === true;

  const gateInput: GateInput = useMemo(
    () => ({
      baselineVerificationImplemented: BASELINE_VERIFICATION_IMPLEMENTED,
      hasPackage: !!pkg,
      packageFileBlockers: pkg?.blockers ?? [],
      collisionDone: !!collision,
      collisionBlockers: collision?.blockers ?? [],
      collisionCounts: collision
        ? {
            hash_mismatch: collision.counts.hash_mismatch,
            unresolved: collision.counts.unresolved,
          }
        : null,
      duplicatePackage,
      duplicateRecovered,
      localValidationClean: localValid.clean,
      localValidationBlockerCount: localValid.blockerCount,
      precheck,
      baselineIdentityOk,
      dry,
      dryIdentityOk: dry
        ? num(dry["comments_to_update"]) ===
          num(dry["comments_unchanged"]) + num(dry["comments_modified"])
        : false,
      attachmentsUnresolved: num(dry?.["attachments_unresolved"]),
      massRetire,
      allowRetire,
      retireCount: retire,
      uploadFailedCount,
      verifyRan,
      verifyOkCount: verifyOk.length,
      verifyFailureCount: verifyFailures.length,
      newAssetTotal,
      snapshotId,
      approved,
    }),
    [
      pkg,
      collision,
      duplicatePackage,
      duplicateRecovered,
      localValid,
      precheck,
      baselineIdentityOk,
      dry,
      massRetire,
      allowRetire,
      retire,
      uploadFailedCount,
      verifyRan,
      verifyOk.length,
      verifyFailures.length,
      newAssetTotal,
      snapshotId,
      approved,
    ],
  );

  const gates = useMemo(
    () => evaluateGates(gateInput, warnings.length),
    [gateInput, warnings.length],
  );
  const blockers = gates.blockers;
  const verifyComplete = gates.step5Complete;

  function resetDownstream() {
    setRunId(null);
    setDry(null);
    setSnapshotId(null);
    setApproved(false);
    setAllowRetire(false);
    setResult(null);
    setFailure(null);
    setImportFailure(null);
    setImportFailStage(null);
    setReceipts([]);
    setVerifyTotal(0);
    setVerifyOk([]);
    setVerifyFailures([]);
    setVerifyRan(false);
    setStageLabel(null);
  }

  function clearPick() {
    resetDownstream();
    setPkg(null);
    setPickedFile(null);
    setLocalValid({ clean: null, blockerCount: 0 });
    setPrecheck(null);
    setCollision(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPickerKey((k) => k + 1);
  }

  async function onPick(files: FileList) {
    const file = files[0];
    if (!file) return;
    // 새 선택 시 이전 패키지 상태를 먼저 전부 폐기한다 (잘못된 파일이어도 이전 결과가 남지 않음)
    setPkg(null);
    setPickedFile(null);
    setLocalValid({ clean: null, blockerCount: 0 });
    setPrecheck(null);
    setCollision(null);
    resetDownstream();
    if (/\.xlsx?$/i.test(file.name)) {
      toast.error("Excel 은 로컬 Codex Skill 에서 처리하고, 완성된 증분 ZIP 을 선택하십시오.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPickerKey((k) => k + 1);
      return;
    }
    setBusy("패키지 검증 중…");
    setStageLabel("1/6 패키지 검증");
    try {
      const p = await readIncrementPackage(file);
      setPkg(p);
      setPickedFile(file);
      setStageLabel("2/6 기존 자산 대조");
      const pc = (await precheckFn({
        data: {
          package_sha256: p.package_sha256,
          base_import_run_id: p.manifest.base_import_run_id,
          base_baseline_id: p.manifest.base_baseline_id,
          base_core_hash: p.manifest.base_core_hash,
          base_core_table_hashes: p.manifest.base_core_table_hashes,
        },
      })) as Record<string, unknown>;
      setPrecheck(pc);
      if (pc["duplicate_package"] === true) {
        // 이미 반영(및 복구)된 패키지는 선택 즉시 차단한다.
        // 상태를 지우지 않고 완료 카드로 run ID 와 함께 명시한다.
        toast.error(
          pc["duplicate_recovered"] === true
            ? "이미 반영 및 복구 완료된 패키지입니다. 다시 실행할 수 없습니다."
            : "이미 반영된 패키지입니다. 다시 실행할 수 없습니다.",
        );
        setCollision(null);
        setOpenStep(4);
        return;
      }
      const col = await checkPackageStorageCollisions(p);
      setCollision(col);
      // 서버 영수증 복원 — 동일 패키지의 과거 서버 실측 검증 결과를 안내한다.
      try {
        const rec = (await listVerifyReceiptsFn({
          data: { package_id: p.manifest.package_id },
        })) as {
          total: number;
          truncated: boolean;
          ok_count: number;
          failed: { path: string }[];
        };
        setRestoredVerify(
          rec.total > 0
            ? `Previous verification receipts were found (${rec.total} · ok ${rec.ok_count} · failed ${rec.failed.length}${rec.truncated ? " · truncated" : ""}). For safety, this run will verify all required assets again.`
            : null,
        );
      } catch {
        setRestoredVerify(null);
      }
      toast.success(
        `패키지 검증 완료 — 내부 파일 ${p.verifiedFiles}건 SHA-256 일치 · Storage 충돌 ${
          col.counts.hash_mismatch + col.counts.unresolved
        }건`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setPkg(null);
      setPrecheck(null);
      setCollision(null);
      setPickerKey((k) => k + 1);
    } finally {
      setBusy(null);
      setStageLabel(null);
    }
  }

  async function stage(
    run: string,
    kind: V3StageKind,
    rows: unknown[],
    base: number,
    span: number,
  ) {
    const batches = chunk(rows, BATCH);
    for (let i = 0; i < batches.length; i += 1) {
      await stageLoad({ data: { run_id: run, kind, rows: batches[i] as unknown[] } });
      setProgress(Math.round(base + ((i + 1) / batches.length) * span));
    }
  }

  async function runDryRun() {
    if (!pkg) return;
    setBusy("증분 Dry-run 실행 중…");
    setProgress(0);
    try {
      const run = crypto.randomUUID();
      await stageReset({ data: { run_id: run } });
      await stage(run, "groups", pkg.atomic.groups, 0, 10);
      await stage(run, "comments", pkg.atomic.comments, 10, 55);
      await stage(run, "attachments", pkg.atomic.attachments, 65, 20);
      await stage(run, "response", pkg.response.segments, 85, 10);
      const out = (await dryRunFn({
        data: {
          run_id: run,
          source_files: pkg.sourceFiles.map((f) => ({
            file_name: f.relative_path.split("/").pop() ?? f.relative_path,
            content_hash: f.sha256,
          })),
        },
      })) as Dry;
      setRunId(run);
      setDry(out);
      setSnapshotId(null);
      setApproved(false);
      setProgress(100);
      toast.success("Dry-run 완료 (운영 데이터 변경 없음)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  /** 기존 run 상태를 조회해 UI 를 복원한다. 새 백업을 시작하지 않는다. */
  async function refreshBackupRun(id: string) {
    const row = (await snapshotStatusFn({ data: { run_id: id } })) as {
      status?: string | null;
      snapshot_id?: string | null;
      error_message?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
    if (!row) return null;
    const m = (row.metadata ?? null) as Record<string, unknown> | null;
    if (m) {
      setSnapshotStatus({
        tablesTotal: num(m["tables_total"]),
        tablesDone: num(m["tables_done"]),
        currentTable: (m["current_table"] as string | null) ?? null,
        sizeBytes: m["size_bytes"] == null ? null : num(m["size_bytes"]),
      });
    }
    if (row.status === "success" && row.snapshot_id) {
      setSnapshotId(row.snapshot_id);
      setSnapshotError(null);
    } else if (row.status === "failed") {
      setSnapshotError(row.error_message ?? "Backup failed");
    }
    return row;
  }

  /**
   * @param retry true 면 새 run ID 로 시작(명시적 Retry). false 면 기존 run 이 있으면 그 상태에 합류.
   */
  /** 경과 타이머만 관리한다. 상태 polling 은 watchRunId 감시 effect 가 담당한다. */
  function startSnapshotTicker(started: number) {
    if (snapshotTickRef.current) clearInterval(snapshotTickRef.current);
    snapshotTickRef.current = setInterval(
      () => setSnapshotElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
  }
  function stopSnapshotTicker() {
    if (snapshotTickRef.current) clearInterval(snapshotTickRef.current);
    snapshotTickRef.current = null;
  }

  async function runSnapshot(retry = false) {
    if (!dry) return;
    if (snapshotLockRef.current) return; // 동기 잠금: 더블클릭·중복 클릭 무시
    snapshotLockRef.current = true;

    // 기존 run 이 있고 명시적 Retry 가 아니면, 새 백업 대신 기존 상태에 합류한다.
    if (!retry && backupRunId) {
      try {
        const row = await refreshBackupRun(backupRunId);
        if (row && (row.status === "running" || row.status === "queued")) {
          toast.info("Backup already running — 기존 실행 상태를 계속 확인합니다.");
          setSnapshotError(null);
          setSnapshotStale(false);
          setSnapshotRunning(true);
          startSnapshotTicker(Date.now() - snapshotElapsed * 1000);
          setWatchRunId(backupRunId); // 잠금은 감시 종료 시 해제된다
          return;
        }
        if (row && row.status === "success") {
          snapshotLockRef.current = false;
          return;
        }
        if (row && row.status === "failed") {
          // 실패 상태는 자동 재실행하지 않는다. 명시적 Retry 클릭에서만 새 run 을 만든다.
          setSnapshotRunning(false);
          snapshotLockRef.current = false;
          return;
        }
      } catch {
        /* 조회 실패 시 아래 로직으로 진행 */
      }
    }

    const runId = crypto.randomUUID();
    setBackupRunId(runId);
    const started = Date.now();
    setSnapshotRunning(true);
    setSnapshotError(null);
    setSnapshotStale(false);
    setSnapshotStatus(null);
    setSnapshotElapsed(0);
    startSnapshotTicker(started);
    setWatchRunId(runId);

    try {
      const res = (await snapshotFn({ data: { module: "abd", run_id: runId } })) as {
        id?: string;
        size_bytes?: number;
        already_running?: boolean;
      } | null;
      if (res?.already_running) {
        // 새 Snapshot·새 run ID 를 만들지 않고 동일 run 을 계속 감시한다.
        toast.info("Backup already running — 기존 실행 상태를 계속 확인합니다.");
        await refreshBackupRun(runId);
        return; // watchRunId 감시 effect 가 success/failed 까지 유지
      }
      if (!res?.id) throw new Error("스냅샷 ID 를 확인하지 못했습니다.");
      setSnapshotId(res.id);
      setSnapshotStatus((prev) => ({
        tablesTotal: prev?.tablesTotal ?? 0,
        tablesDone: prev?.tablesTotal ?? prev?.tablesDone ?? 0,
        currentTable: null,
        sizeBytes: res.size_bytes ?? prev?.sizeBytes ?? null,
      }));
      toast.success(`Snapshot created — ${res.id}`);
      setWatchRunId(null);
      stopSnapshotTicker();
      setSnapshotRunning(false);
      snapshotLockRef.current = false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSnapshotError(msg);
      toast.error(msg);
      setWatchRunId(null);
      stopSnapshotTicker();
      setSnapshotRunning(false);
      snapshotLockRef.current = false;
    }
  }

  /**
   * 기존 running run 감시 — 3초 주기로 동일 run ID 만 조회한다.
   * success/failed 에서 종료, 시간 초과 시 "상태 확인 필요" 로만 표시하고 실패로 단정하지 않는다.
   * 중복 interval 생성 없음(단일 effect), unmount 시 정리.
   */
  useEffect(() => {
    if (!watchRunId) return;
    const deadline = Date.now() + SNAPSHOT_WATCH_TIMEOUT_MS;
    let stopped = false;

    const finish = () => {
      stopped = true;
      clearInterval(timer);
      stopSnapshotTicker();
      setSnapshotRunning(false);
      setWatchRunId(null);
      snapshotLockRef.current = false;
    };

    const timer = setInterval(() => {
      void (async () => {
        if (stopped) return;
        try {
          const row = await refreshBackupRun(watchRunId);
          if (row?.status === "success" && row.snapshot_id) {
            toast.success(`Snapshot created — ${row.snapshot_id}`);
            finish();
            return;
          }
          if (row?.status === "failed") {
            toast.error(row.error_message ?? "Backup failed");
            finish();
            return;
          }
        } catch {
          /* 조회 실패는 백업 자체 실패가 아니다 — 다음 주기에 재시도 */
        }
        if (Date.now() > deadline) {
          setSnapshotStale(true);
          finish();
        }
      })();
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchRunId]);

  useEffect(() => () => stopSnapshotTicker(), []);

  /**
   * source/ 와 images/ 바이너리 보존 업로드 (upsert:false · 기존 파일 미덮어쓰기).
   * 동시 5개 제한 큐로 실행하고, 성공·기존·실패를 모두 receipt 로 남긴다. 자동 DELETE 없음.
   */
  async function uploadAssets(
    p: IncrementPackage,
    run: string,
    prev: UploadReceipt[],
  ): Promise<UploadReceipt[]> {
    const skip = collision?.skipPaths ?? new Set<string>();
    const declaredNewPaths = new Set(
      (collision?.rows ?? []).filter((r) => r.state === "declared_new").map((r) => r.path),
    );
    const jobs: { bucket: string; path: string; sha256: string; bytes: ArrayBuffer }[] = [
      ...p.images.map((b) => ({
        bucket: OCS_BUCKET,
        path: imageStoragePath(b.relative_path),
        sha256: b.sha256,
        bytes: b.bytes,
      })),
      ...p.sourceFiles.map((b) => ({
        bucket: OCS_SOURCE_BUCKET,
        path: sourceStoragePath(p.manifest.package_id, b.relative_path),
        sha256: b.sha256,
        bytes: b.bytes,
      })),
    ];

    // 전체 asset 을 bucket::path 로 정본화하고, 기존 영수증은 조건에 맞을 때만 재사용한다.
    const key = (bucket: string, path: string) => `${bucket}::${path}`;
    const prevByKey = new Map(
      prev
        .filter((r) => r.run_id === run && r.package_id === p.manifest.package_id)
        .map((r) => [key(r.bucket, r.path), r]),
    );
    const out = new Array<UploadReceipt>(jobs.length);
    let cursor = 0;
    let done = 0;

    const worker = async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        const job = jobs[i];
        if (!job) return;
        const base = {
          run_id: run,
          package_id: p.manifest.package_id,
          bucket: job.bucket,
          path: job.path,
          sha256: job.sha256,
        };
        const prevRec = prevByKey.get(key(job.bucket, job.path));
        const reusable =
          prevRec !== undefined &&
          prevRec.sha256 === job.sha256 &&
          prevRec.state !== "failed" &&
          (prevRec.state === "existing" ? skip.has(job.path) : !skip.has(job.path));
        // 기존 동일 hash 는 요청 자체를 보내지 않는다.
        if (reusable) {
          out[i] = prevRec as UploadReceipt;
        } else if (skip.has(job.path)) {
          out[i] = { ...base, state: "existing" };
        } else {
          const { error } = await supabase.storage
            .from(job.bucket)
            .upload(job.path, new Blob([job.bytes]), { upsert: false });
          if (!error) {
            // 재시도 성공 시 기존 failed 영수증을 uploaded 로 교체한다.
            out[i] = { ...base, state: "uploaded" };
          } else if (declaredNewPaths.has(job.path)) {
            // Storage object 는 있으나 DB metadata 가 없는 경우 — 서버가 실측 검증한다.
            out[i] = { ...base, state: "declared_new" };
          } else {
            // 파일명이 보인다는 이유만으로 성공 처리하지 않는다 — 검증 불가 object 는 실패다.
            out[i] = { ...base, state: "failed", error: error.message };
          }
        }
        done += 1;
        setProgress(Math.round((done / jobs.length) * 100));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(jobs.length, 1)) }, worker),
    );
    const list = out.filter(Boolean) as UploadReceipt[];
    setReceipts(list);
    return list;
  }

  /**
   * 신규 자산 업로드 → 서버 실측 검증(배치).
   * 클라이언트 신고 hash 를 믿지 않는다. 서버가 object 를 직접 내려받아 SHA-256/byte_size 를
   * 실측하고 run_id/package_id 기준 영수증으로 저장한다. 실패분만 재실행 가능.
   */
  async function runUploadVerify() {
    if (!pkg || !runId) return;
    setBusy("신규 자산 업로드 · 서버 실측 검증 중…");
    setProgress(0);
    setFailure(null);
    try {
      // 영수증이 있어도 실패분·누락분은 반드시 다시 업로드한다.
      setStageLabel("4/6 신규 자산 업로드");
      let rec = await uploadAssets(pkg, runId, receipts);

      const sizeByPath = new Map<string, number>();
      for (const b of pkg.images) sizeByPath.set(imageStoragePath(b.relative_path), b.byte_size);
      for (const b of pkg.sourceFiles) {
        sizeByPath.set(sourceStoragePath(pkg.manifest.package_id, b.relative_path), b.byte_size);
      }

      // 네트워크 모호 오류 복구 — 업로드는 오류를 반환했으나 object 가 실제 저장된 경우가 있다.
      // 실패 path 를 서버 검증 배치로 실측해 hash/size 가 일치하면 declared_new 로 교정한다.
      const ambiguous = rec.filter((r) => r.state === "failed");
      if (ambiguous.length > 0) {
        setStageLabel(`4/6 업로드 실패분 서버 실측 확인 (${ambiguous.length}건)`);
        const recovered = new Map<string, string | null>();
        for (const batch of chunk(ambiguous, VERIFY_BATCH_MAX) as UploadReceipt[][]) {
          const items = batch.map((t) => ({
            bucket: t.bucket,
            path: t.path,
            expected_sha256: t.sha256,
            expected_byte_size: sizeByPath.get(t.path) ?? 0,
          }));
          const probe = (await verifyFn({
            data: { run_id: runId, package_id: pkg.manifest.package_id, items },
          })) as { failed?: { path: string; error: string | null }[] };
          const bad = new Map((probe.failed ?? []).map((f) => [f.path, f.error]));
          for (const it of items) {
            if (!bad.has(it.path)) recovered.set(it.path, null);
            else recovered.set(it.path, bad.get(it.path) ?? "verify failed");
          }
        }
        rec = rec.map((r) =>
          r.state === "failed" && recovered.get(r.path) === null
            ? { ...r, state: "declared_new" as const, error: undefined }
            : r,
        );
        setReceipts(rec);
      }
      const failedUploads = rec.filter((r) => r.state === "failed");

      const targets = rec.filter((r) => r.state === "uploaded" || r.state === "declared_new");
      // 분모는 성공 영수증 수가 아니라 "서버 검증이 필요한 전체 신규 asset 수" 로 고정한다.
      setVerifyTotal(newAssetTotal);
      setVerifyRan(true);
      const okSet = new Set(verifyOk);
      const pending = targets.filter((t) => !okSet.has(t.path));
      setStageLabel(`5/6 서버 실측 검증 (${pending.length}건)`);

      const failures: { path: string; error: string }[] = [];
      const batches = chunk(pending, VERIFY_BATCH_MAX) as UploadReceipt[][];
      for (let i = 0; i < batches.length; i += 1) {
        const items = batches[i]!.map((t) => ({
          bucket: t.bucket,
          path: t.path,
          expected_sha256: t.sha256,
          expected_byte_size: sizeByPath.get(t.path) ?? 0,
        }));
        const out = (await verifyFn({
          data: { run_id: runId, package_id: pkg.manifest.package_id, items },
        })) as { failed?: { path: string; error: string | null }[] };
        const failedPaths = new Set((out.failed ?? []).map((f) => f.path));
        for (const f of out.failed ?? []) failures.push({ path: f.path, error: f.error ?? "" });
        for (const it of items) if (!failedPaths.has(it.path)) okSet.add(it.path);
        setVerifyOk([...okSet]);
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }
      setVerifyFailures(failures);
      if (failedUploads.length > 0) {
        toast.error(
          `자산 업로드 실패 ${failedUploads.length}건 — 재실행하면 실패분만 다시 업로드합니다: ${failedUploads
            .slice(0, 3)
            .map((r) => `${r.path} — ${r.error ?? ""}`)
            .join(" / ")}`,
        );
      } else if (failures.length > 0) {
        toast.error(`서버 실측 검증 실패 ${failures.length}건 — 실패분만 재실행하십시오.`);
      } else if (okSet.size < newAssetTotal) {
        toast.error(`서버 실측 검증 미완료 — ${okSet.size}/${newAssetTotal}`);
      } else {
        toast.success(`서버 실측 검증 완료 — ${okSet.size}/${newAssetTotal}건`);
      }
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(0);
      setStageLabel(null);
    }
  }

  async function runImport() {
    if (!pkg || !runId || !snapshotId || blockers.length > 0 || importRunning) return;
    setImportRunning(true);
    setImportElapsed(0);
    setFailure(null);
    setImportFailStage(null);
    setImportFailure(null);
    const startedAt = Date.now();
    const tick = setInterval(
      () => setImportElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    try {
      const rec = receipts;
      const out = (await importFn({
        data: {
          run_id: runId,
          snapshot_id: snapshotId,
          package_id: pkg.manifest.package_id,
          package_name: pkg.file_name,
          package_sha256: pkg.package_sha256,
          manifest_name: "manifest.json",
          manifest_hash: pkg.package_sha256,
          data_date: pkg.manifest.data_date,
          base_import_run_id: pkg.manifest.base_import_run_id,
          base_baseline_id: pkg.manifest.base_baseline_id,
          base_core_hash: pkg.manifest.base_core_hash,
          base_core_table_hashes: pkg.manifest.base_core_table_hashes,
          base_generated_at: pkg.manifest.base_generated_at,
          allow_retire: allowRetire,
          image_meta: pkg.imageMeta,
          upload_receipts: rec,
          local_validation: localValid.receipt
            ? {
                payload_sha256: localValid.receipt.payload_sha256,
                package_sha256: pkg.package_sha256,
                clean: localValid.receipt.clean,
                baseline_id: localValid.receipt.baseline_id,
                validator_version: localValid.receipt.validator_version,
              }
            : null,
          source_files: pkg.sourceFiles.map((f) => ({
            file_name: f.relative_path.split("/").pop() ?? f.relative_path,
            content_hash: f.sha256,
          })),
          source_meta: pkg.sourceFiles.map((f) => ({
            source_file_id: f.sha256,
            file_name: f.relative_path.split("/").pop() ?? f.relative_path,
            relative_path: f.relative_path,
            storage_path: sourceStoragePath(pkg.manifest.package_id, f.relative_path),
            content_hash: f.sha256,
            byte_size: f.byte_size,
            mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })),
          assets: [
            ...pkg.images.map((b) => ({
              kind: "image" as const,
              bucket: OCS_BUCKET,
              path: imageStoragePath(b.relative_path),
              sha256: b.sha256,
            })),
            ...pkg.sourceFiles.map((b) => ({
              kind: "source" as const,
              bucket: OCS_SOURCE_BUCKET,
              path: sourceStoragePath(pkg.manifest.package_id, b.relative_path),
              sha256: b.sha256,
            })),
          ],
        },
      })) as Record<string, unknown>;
      setResult(out);
      const ok = evaluateImportSuccess(out);
      if (ok.complete) toast.success(`Import completed — run ${runId}`);
      else toast.warning("Import 결과 검증이 필요합니다. Step 8 안내를 확인하십시오.");
    } catch (e) {
      const state = classifyImportFailure(e);
      setFailure(state.message);
      setImportFailure(state);
      setImportFailStage(state.stage);
      toast.error(state.title);
    } finally {
      clearInterval(tick);
      setImportRunning(false);
    }
  }

  if (meLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 권한 확인 중…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex items-center gap-2 p-6 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />이 화면은 관리자(admin) 또는 HDEC
          PIC(Team DESN) 전용입니다.
        </CardContent>
      </Card>
    );
  }

  // ── Wizard 단계 상태 판정 (기존 blockers/서버 판정을 재사용만 한다) ──
  const duplicateLog = (precheck?.["duplicate_log"] ?? null) as {
    id?: string;
    data_file_name?: string;
    started_at?: string;
  } | null;
  const duplicateRecoveryLog = (precheck?.["duplicate_recovery_log"] ?? null) as {
    id?: string;
    started_at?: string;
  } | null;

  const prepDone = prepChecks.every(Boolean);
  const step1Done = baselineConfirmed || skipPreparation;
  const step2Done = prepDone || skipPreparation;
  const step3Done = packageBuilt || skipPreparation;
  const step4Done = gates.step4Complete;
  const step5Done = gates.step5Complete;
  const step6Done = gates.step6Complete;
  const importSuccess = evaluateImportSuccess(result);
  const step7Done = !!result;
  const step8Done = importSuccess.complete;

  const statusOf = (done: boolean, current: boolean, warn = false, blocked = false): StepStatus =>
    blocked ? "blocked" : done ? "done" : warn ? "warning" : current ? "current" : "pending";

  const firstOpen = [
    step1Done,
    step2Done,
    step3Done,
    step4Done,
    step5Done,
    step6Done,
    step7Done,
    step8Done,
  ].findIndex((d) => !d);
  const currentStep = firstOpen === -1 ? 8 : firstOpen + 1;

  const steps: WizardStep[] = [
    {
      index: 1,
      title: "Download Latest OCS Baseline",
      group: "preparation",
      status: statusOf(step1Done, currentStep === 1, !!baselineInfoError),
    },
    {
      index: 2,
      title: "Prepare OCS Files",
      group: "preparation",
      status: statusOf(step2Done, currentStep === 2),
    },
    {
      index: 3,
      title: "Build Increment Package",
      group: "preparation",
      status: statusOf(step3Done, currentStep === 3),
    },
    {
      index: 4,
      title: "Select and Check the Increment Package",
      group: "import",
      status: statusOf(step4Done, currentStep === 4, false, duplicatePackage),
    },
    {
      index: 5,
      title: "Upload and Verify Files",
      group: "import",
      status: statusOf(step5Done, currentStep === 5, uploadFailedCount > 0),
    },
    {
      index: 6,
      title: "Create Pre-import Backup",
      group: "import",
      status: statusOf(step6Done, currentStep === 6, !!snapshotError),
    },
    {
      index: 7,
      title: "Review and Import",
      group: "import",
      status: statusOf(step7Done, currentStep === 7, false, !!failure),
    },
    {
      index: 8,
      title: "Complete",
      group: "import",
      status: statusOf(step8Done, currentStep === 8),
    },
  ];

  const toggle = (i: number) => setOpenStep((cur) => (cur === i ? 0 : i));
  const packageStatus = gates.packageStatus;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageOpen className="h-4 w-4" /> ABD OCS Increment — Guided Workflow
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            DAR 신규·개정 OCS 를 8단계로 반영합니다. 1~3 단계는 로컬 Codex Skill 준비, 4~8 단계는
            QAIL CMS 의 검증·반영입니다. 파일명 계약:{" "}
            <code>OCS_Increment_&lt;YYYYMMDD&gt;_&lt;seq&gt;.zip</code>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <OcsResponsibilityCard />
          {!pkg && (
            <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
              <div className="mb-1 font-semibold text-foreground">
                새로고침 후 복원되는 항목 / 복원되지 않는 항목
              </div>
              <div>
                복원됨: 최신 Baseline 정보 · 패키지의 과거 검증 영수증 존재 여부 · 완료·복구 패키지
                중복 차단
              </div>
              <div>
                복원되지 않음: 선택한 ZIP 파일 · Dry-run 결과 · 현재 Snapshot ID · Import 진행
                상태와 결과 — Re-select the ZIP to restore and verify this workflow.
              </div>
            </div>
          )}
          <OcsWizardStepper steps={steps} onSelect={(i) => setOpenStep(i)} />
          {busy && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {busy}
                {stageLabel ? ` · ${stageLabel}` : ""}
              </div>
              {progress > 0 && <Progress value={progress} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ───────── Step 1 ───────── */}
      <OcsWizardStepCard
        index={1}
        title="Download Latest OCS Baseline"
        description="새로운 DAR OCS 파일을 처리할 때마다 가장 먼저 최신 운영 OCS 데이터를 내려받습니다."
        status={steps[0]!.status}
        open={openStep === 1}
        onToggle={() => toggle(1)}
        summary={
          baselineInfo?.exists ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {baselineInfo.baseline_id.slice(0, 16)} ·{" "}
              {baselineInfo.is_latest ? "Latest" : "Outdated"}
            </span>
          ) : null
        }
      >
        <p className="text-xs text-muted-foreground">
          Baseline 은 로컬 Codex Skill 이 기존 코멘트, ID, Response 및 이미지 연결을 재사용하는 기준
          데이터입니다. 오래 보관한 Baseline 을 다음 증분에 재사용하지 마십시오.
        </p>
        <OcsBaselineCard />
        <div className="rounded-md border p-3">
          <div className="mb-1 text-xs font-semibold">현재 서버 정본 Baseline</div>
          {baselineInfoError ? (
            <OcsErrorCard
              title="Baseline 정보를 불러오지 못했습니다."
              affected="Step 1 표시 정보만 영향을 받으며 운영 데이터는 변경되지 않았습니다."
              nextStep="새로고침 후 다시 시도하거나 Generate Latest Baseline 을 실행하십시오."
              details={baselineInfoError}
            />
          ) : baselineInfo ? (
            <>
              <Row label="Baseline ID" value={baselineInfo.baseline_id} />
              <Row label="Generated at" value={baselineInfo.generated_at ?? "—"} />
              <Row label="Data date" value={baselineInfo.data_date ?? "—"} />
              <Row label="Dataset rows" value={baselineInfo.total_rows ?? "—"} />
              <Row
                label="ZIP size"
                value={
                  baselineInfo.zip_byte_size
                    ? `${(baselineInfo.zip_byte_size / 1024 / 1024).toFixed(2)} MB`
                    : "—"
                }
              />
              <Row
                label="Status"
                value={
                  baselineInfo.exists
                    ? baselineInfo.is_latest
                      ? "Latest"
                      : "Outdated"
                    : "Not generated"
                }
                bad={!baselineInfo.exists}
              />
              {baselineInfo.files.length > 0 && (
                <details className="mt-2 rounded-md border bg-muted/40 p-2">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Technical details ({baselineInfo.files.length} datasets)
                  </summary>
                  <div className="mt-1 max-h-48 overflow-auto font-mono text-[11px]">
                    {baselineInfo.files.map((f) => (
                      <div key={f.name}>
                        {f.name} · {f.row_count ?? "—"} rows · {f.byte_size} bytes
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Baseline 정보 조회 중…
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Baseline ZIP is ready. Confirm that the file was saved on this computer.
        </p>
        <div className="rounded-md border p-3">
          <CheckItem
            checked={baselineConfirmed}
            onChange={setBaselineConfirmed}
            label="I saved the Baseline ZIP on this computer."
          />
        </div>
      </OcsWizardStepCard>

      {/* ───────── Step 2 ───────── */}
      <OcsWizardStepCard
        index={2}
        title="Prepare OCS Files"
        description="DAR 에서 새로 받은 신규·개정 OCS Excel 만 한 폴더에 모읍니다."
        status={steps[1]!.status}
        open={openStep === 2}
        onToggle={() => toggle(2)}
      >
        <Step2PrepareFiles
          checks={prepChecks}
          onChange={(i, v) =>
            setPrepChecks((prev) => {
              const next = [...prev] as [boolean, boolean, boolean];
              next[i] = v;
              return next;
            })
          }
        />
      </OcsWizardStepCard>

      {/* ───────── Step 3 ───────── */}
      <OcsWizardStepCard
        index={3}
        title="Build Increment Package"
        description="로컬 qail-ocs-increment Skill 로 증분 ZIP 을 생성합니다."
        status={steps[2]!.status}
        open={openStep === 3}
        onToggle={() => toggle(3)}
      >
        <Step3BuildPackage confirmed={packageBuilt} onConfirm={setPackageBuilt} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSkipPreparation(true);
              setOpenStep(4);
            }}
          >
            I already have a completed Increment ZIP
          </Button>
          <span className="text-[11px] text-muted-foreground">
            준비 단계만 건너뜁니다. Step 4 의 서버 검증은 그대로 수행됩니다.
          </span>
        </div>
      </OcsWizardStepCard>

      {/* ───────── Step 4 ───────── */}
      <OcsWizardStepCard
        index={4}
        title="Select and Check the Increment Package"
        description="완성된 Increment ZIP 한 개만 선택하고, 운영 DB 와 비교하는 Dry-run 을 실행합니다."
        status={steps[3]!.status}
        open={openStep === 4}
        onToggle={() => toggle(4)}
        summary={pkg ? <span className="font-mono text-[11px]">{pkg.file_name}</span> : null}
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilePickerButton
            label={pkg ? "Change Increment ZIP" : "Choose Increment ZIP"}
            accept=".zip,application/zip"
            disabled={!!busy}
            inputRef={fileInputRef}
            resetKey={pickerKey}
            onFiles={(f) => void onPick(f)}
          />
          {pkg && (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> {pkg.file_name}
            </Badge>
          )}
          {(pkg || failure) && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={clearPick}>
              Clear
            </Button>
          )}
        </div>

        <OcsLocalValidationCard
          file={pickedFile}
          pkg={pkg}
          onCleanChange={(st) => setLocalValid(st)}
        />

        {duplicatePackage && (
          <div className="space-y-2 rounded-md border border-destructive/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {duplicateRecovered
                ? "This package was already imported and successfully recovered. Do not import it again."
                : "This package was already imported. Do not import it again."}
            </div>
            <Row label="original import run" value={duplicateLog?.id ?? "—"} />
            <Row label="imported at" value={duplicateLog?.started_at ?? "—"} />
            {duplicateRecovered && (
              <>
                <Row label="recovery run" value={duplicateRecoveryLog?.id ?? "—"} />
                <Row label="recovered at" value={duplicateRecoveryLog?.started_at ?? "—"} />
                <div className="text-[11px] text-emerald-700">
                  Partial import recovered successfully.
                </div>
              </>
            )}
          </div>
        )}

        {pkg && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold">패키지</div>
              <Row label="Package file" value={pkg.file_name} />
              <Row label="Package ID" value={pkg.manifest.package_id} />
              <Row label="Data date" value={pkg.manifest.data_date} bad={!pkg.manifest.data_date} />
              <Row label="Baseline ID" value={pkg.manifest.base_baseline_id} />
              <Row label="Base Import run" value={pkg.manifest.base_import_run_id} />
              <Row label="OCS files" value={pkg.manifest.target_ocs_numbers.length} />
              <Row label="구분" value={pkg.manifest.change_type} />
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold">내부 파일 검증</div>
              <Row label="manifest files" value={pkg.manifest.files.length} />
              <Row label="SHA-256 일치" value={pkg.verifiedFiles} />
              <Row label="Source Excel files" value={pkg.sourceFiles.length} />
              <Row label="Images" value={pkg.images.length} />
              <Row label="Atomic comments" value={pkg.atomic.comments.length} />
              <details className="mt-2 rounded-md border bg-muted/40 p-2">
                <summary className="cursor-pointer text-[11px] font-medium">
                  Technical details
                </summary>
                <div className="mt-1 max-h-48 overflow-auto font-mono text-[11px]">
                  <div>package SHA-256: {pkg.package_sha256}</div>
                  {pkg.manifest.files.map((f) => (
                    <div key={f.relative_path}>{f.relative_path}</div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}

        {collision && (
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-semibold">Storage 충돌 점검 (읽기 전용)</div>
            <div className="grid gap-3 md:grid-cols-5">
              <Row label="new" value={collision.counts.new} />
              <Row label="existing (skip)" value={collision.counts.existing} />
              <Row label="declared_new" value={collision.counts.declared_new} />
              <Row
                label="hash_mismatch"
                value={collision.counts.hash_mismatch}
                bad={collision.counts.hash_mismatch > 0}
              />
              <Row
                label="unresolved"
                value={collision.counts.unresolved}
                bad={collision.counts.unresolved > 0}
              />
            </div>
            {collision.rows.filter((r) => r.state === "hash_mismatch" || r.state === "unresolved")
              .length > 0 && (
              <div className="mt-2 max-h-56 overflow-auto rounded-md border p-2 text-[11px]">
                {collision.rows
                  .filter((r) => r.state === "hash_mismatch" || r.state === "unresolved")
                  .map((r) => (
                    <div key={`${r.bucket}/${r.path}`} className="font-mono text-destructive">
                      [{r.state}] {r.bucket}/{r.path}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!pkg || !!busy || duplicatePackage || localValid.clean !== true}
            onClick={() => void runDryRun()}
          >
            Check Package — No Data Will Be Changed
          </Button>
          <span className="text-[11px] text-muted-foreground">
            현재 운영 DB 와 패키지를 비교하지만 데이터를 수정하지 않습니다.
          </span>
        </div>

        {duplicatePackage && (
          <div className="space-y-1 rounded-md border border-emerald-600 bg-emerald-50/60 p-3 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> 이 패키지는 이미 반영 완료되었습니다 — 실패가
              아닙니다
            </div>
            <p className="text-[11px] text-muted-foreground">
              동일한 ZIP(SHA-256)이 과거 Import 에서 이미 운영 DB 에 반영되었습니다. 같은 내용을 다시
              넣으면 중복이 생기므로 시스템이 재실행을 막습니다. 추가로 하실 일은 없습니다.
              {duplicateRecovered && " (이후 복구 작업까지 완료된 패키지입니다.)"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Check Package 결과가 <b>comments_new 0 · unchanged 다수</b> 로 나오는 것도 같은
              이유이며 정상입니다. 다음 증분 작업은 <b>새 Baseline 생성 후 새 ZIP</b> 으로
              진행하세요.
            </p>
            {(() => {
              const dl = (precheck?.["duplicate_log"] ?? null) as Record<string, unknown> | null;
              if (!dl) return null;
              return (
                <div className="pt-1 font-mono text-[11px] text-muted-foreground">
                  기존 Import run: {String(dl["id"] ?? "")} · status {String(dl["status"] ?? "")}
                </div>
              );
            })()}
          </div>
        )}

        {dry && (
          <>
            <div
              className={`rounded-md border p-2 text-xs font-semibold ${
                packageStatus === "pass"
                  ? "border-emerald-600 text-emerald-700"
                  : packageStatus === "warn"
                    ? "border-amber-500 text-amber-600"
                    : "border-destructive text-destructive"
              }`}
            >
              {packageStatus === "pass"
                ? "Package check passed"
                : packageStatus === "warn"
                  ? "Package can proceed with warnings"
                  : duplicatePackage
                    ? "이미 반영 완료된 패키지입니다 — 다시 Import 하지 않습니다"
                    : "Package cannot be imported"}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">Scope</div>
                <Row label="scope_ocs_count" value={dry["scope_ocs_count"]} />
                <Row label="scope_existing_active" value={dry["scope_existing_active"]} />
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">코멘트</div>
                <Row label="comments_new" value={dry["comments_new"]} />
                <Row label="comments_to_update" value={dry["comments_to_update"]} />
                <Row label="comments_unchanged" value={dry["comments_unchanged"]} />
                <Row label="comments_modified" value={dry["comments_modified"]} />
                <Row
                  label="comments_to_retire"
                  value={dry["comments_to_retire"]}
                  bad={massRetire}
                />
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">첨부 · 원본 Excel</div>
                <Row label="attachments_new" value={dry["attachments_new"]} />
                <Row label="attachments_existing" value={dry["attachments_existing"]} />
                <Row
                  label="attachments_unresolved"
                  value={dry["attachments_unresolved"]}
                  bad={num(dry["attachments_unresolved"]) > 0}
                />
                <Row label="images_new" value={dry["images_new"]} />
                <Row label="images_existing" value={dry["images_existing"]} />
                <Row
                  label="images_conflict"
                  value={dry["images_conflict"]}
                  bad={num(dry["images_conflict"]) > 0}
                />
                <Row
                  label="images_meta_missing"
                  value={dry["images_meta_missing"]}
                  bad={num(dry["images_meta_missing"]) > 0}
                />
                <Row label="source_files_new" value={dry["source_files_new"]} />
                <Row label="source_files_revised" value={dry["source_files_revised"]} />
                <Row label="source_files_existing" value={dry["source_files_existing"]} />
              </div>
              <div className="rounded-md border p-3 md:col-span-3">
                <div className="mb-1 text-xs font-semibold">
                  범위 밖 보호 해시 (Import 전후 대조)
                </div>
                <Row label="comments hash" value={dry["outside_scope_comment_hash_before"]} />
                <Row label="links hash" value={dry["outside_scope_link_hash_before"]} />
              </div>
            </div>
          </>
        )}

        {dry && massRetire && (
          <div className="space-y-2 rounded-md border border-destructive/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> 대량 퇴역 차단
            </div>
            <p className="text-[11px] text-muted-foreground">
              퇴역 예정 {retire}건이 임계(범위 내 active 의 <b>30%</b> 또는 <b>100건</b>)를
              넘었습니다.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allowRetire} onCheckedChange={(v) => setAllowRetire(v === true)} />
              Allow retire — 퇴역 {retire}건을 확인했습니다
            </label>
          </div>
        )}
      </OcsWizardStepCard>

      {/* ───────── Step 5 ───────── */}
      <OcsWizardStepCard
        index={5}
        title="Upload and Verify Files"
        description="새 이미지와 Source Excel 만 업로드하고 서버가 각 파일의 SHA-256 과 크기를 직접 검증합니다."
        status={steps[4]!.status}
        open={openStep === 5}
        onToggle={() => toggle(5)}
        locked={!gates.step5Unlocked}
        lockReasons={
          !gates.step5Unlocked
            ? ["Step 4 (ZIP 계약 · Precheck · Dry-run · 항등식 · blocker 0) 통과 후 활성화됩니다."]
            : []
        }
        summary={
          verifyTotal > 0 ? (
            <span className="text-[11px]">
              server-verified {verifyOk.length}/{newAssetTotal}
            </span>
          ) : null
        }
      >
        {restoredVerify && (
          <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
            {restoredVerify}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!pkg || !dry || !!busy || !!result}
            onClick={() => void runUploadVerify()}
          >
            {uploadFailedCount > 0 || verifyFailures.length > 0
              ? "Retry Failed Files"
              : "Upload & Verify Files"}
          </Button>
          {uploadFailedCount > 0 && (
            <Badge variant="outline" className="gap-1 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" /> upload failed {uploadFailedCount}
            </Badge>
          )}
          {(verifyRan || verifyTotal > 0) && (
            <Badge
              variant="outline"
              className={`gap-1 text-[11px] ${verifyComplete ? "" : "text-destructive"}`}
            >
              {verifyComplete && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
              server-verified {verifyOk.length}/{newAssetTotal}
            </Badge>
          )}
        </div>
        {busy && (
          <p className="text-xs font-medium text-amber-600">Do not refresh or close this page.</p>
        )}
        {verifyComplete && (
          <div className="text-xs font-medium text-emerald-600">
            All files were uploaded and verified successfully.
          </div>
        )}
        {receipts.length > 0 && (
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-semibold">
              업로드 영수증 (uploaded {receipts.filter((r) => r.state === "uploaded").length} ·
              existing {receipts.filter((r) => r.state === "existing").length} · failed{" "}
              {uploadFailedCount})
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              실패분은 자동 삭제하지 않습니다. 동일 ZIP 을 다시 선택하면 이미 올라간 object 는
              건너뛰고 실패분만 재시도합니다.
            </p>
            <div className="max-h-40 overflow-auto font-mono text-[11px]">
              {uploadFailures.map((r) => (
                <div key={`${r.bucket}/${r.path}`} className="text-destructive">
                  [failed] {r.bucket}/{r.path} — {r.error ?? ""}
                </div>
              ))}
            </div>
          </div>
        )}
        {verifyTotal > 0 && (
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-semibold">
              서버 실측 검증 (ok {verifyOk.length} / {verifyTotal} · 배치 {VERIFY_BATCH_MAX}건 ·
              동시성 5)
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              첨부 연결 정본은 <code>abd_ocs_attachment_comment_links</code> 이며, 레거시{" "}
              <code>link_status</code>·<code>comment_id</code> 로 연결 여부를 판정하지 않습니다.
            </p>
            {verifyFailures.length > 0 && (
              <div className="max-h-40 overflow-auto font-mono text-[11px] text-destructive">
                {verifyFailures.map((f) => (
                  <div key={f.path}>
                    [verify-failed] {f.path} — {f.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </OcsWizardStepCard>

      {/* ───────── Step 6 ───────── */}
      <OcsWizardStepCard
        index={6}
        title="Create Pre-import Backup"
        description="운영 DB 변경 전에 복구 가능한 Snapshot 을 생성합니다. 성공한 Snapshot 없이는 Import 할 수 없습니다."
        status={steps[5]!.status}
        open={openStep === 6}
        onToggle={() => toggle(6)}
        locked={!gates.step6Unlocked}
        lockReasons={
          !gates.step6Unlocked
            ? [
                "Step 5 (업로드 실패 0 · 서버 검증 전량 통과 · hash mismatch 0 · unresolved 0) 완료 후 활성화됩니다.",
              ]
            : []
        }
        summary={snapshotId ? <span className="font-mono text-[11px]">{snapshotId}</span> : null}
      >
        <Button
          size="sm"
          disabled={!gates.step6Unlocked || !!busy || snapshotRunning}
          onClick={() => void runSnapshot(!!snapshotError)}
        >
          {snapshotRunning ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Creating Backup…
            </>
          ) : snapshotError ? (
            "Retry Backup"
          ) : (
            "Create Pre-import Backup"
          )}
        </Button>
        {snapshotRunning && (
          <div className="space-y-1 rounded-md border p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Loader2 className="h-3 w-3 animate-spin" /> Creating Backup…
              <span className="font-mono text-muted-foreground">
                {Math.floor(snapshotElapsed / 60)}m {snapshotElapsed % 60}s
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Backing up ABD and OCS tables. This may take several minutes. Do not navigate away or
              refresh this page.
            </p>
            {snapshotStatus && snapshotStatus.tablesTotal > 0 && (
              <>
                <div className="text-xs text-muted-foreground">
                  tables {snapshotStatus.tablesDone}/{snapshotStatus.tablesTotal}
                  {snapshotStatus.currentTable ? ` — ${snapshotStatus.currentTable}` : ""}
                </div>
                <Progress value={(snapshotStatus.tablesDone / snapshotStatus.tablesTotal) * 100} />
              </>
            )}
          </div>
        )}
        {snapshotStale && !snapshotRunning && !snapshotId && (
          <div className="space-y-1 rounded-md border border-amber-500/50 p-3 text-xs">
            <div className="font-medium text-amber-600">상태 확인 필요</div>
            <p className="text-muted-foreground">
              제한 시간 안에 백업 완료를 확인하지 못했습니다. 백업이 실패했다고 단정할 수 없으며,
              서버에서 계속 진행 중일 수 있습니다. 새 백업을 만들지 말고 아래 버튼으로 동일 백업
              상태를 다시 확인하십시오.
            </p>
            {backupRunId && (
              <div className="font-mono text-[11px] text-muted-foreground">
                Backup run ID: {backupRunId}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!backupRunId) return;
                setSnapshotStale(false);
                setSnapshotRunning(true);
                snapshotLockRef.current = true;
                startSnapshotTicker(Date.now() - snapshotElapsed * 1000);
                setWatchRunId(backupRunId);
              }}
            >
              상태 다시 확인
            </Button>
          </div>
        )}
        {snapshotId && !snapshotRunning && (
          <div className="space-y-1 rounded-md border p-3 text-xs">
            <div className="font-medium text-emerald-600">Backup completed</div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-muted-foreground">
              {snapshotId}
              {snapshotStatus?.sizeBytes
                ? ` · ${(snapshotStatus.sizeBytes / 1024 / 1024).toFixed(2)} MB`
                : ""}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() => {
                  void navigator.clipboard.writeText(snapshotId);
                  toast.success("Snapshot ID copied");
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> Copy
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Snapshot ID 는 Import 실행에 자동 연결됩니다.
            </div>
          </div>
        )}
        {snapshotError && !snapshotRunning && (
          <OcsErrorCard
            title="Backup failed"
            affected="운영 데이터와 업로드된 파일은 변경되지 않았습니다. 백업 단계만 실패했습니다."
            nextStep="Retry Backup 을 눌러 백업만 다시 실행하십시오. 파일을 다시 업로드할 필요는 없습니다."
            runId={backupRunId}
            runLabel="Backup run"
            details={snapshotError}
            action={
              <Button size="sm" variant="outline" onClick={() => void runSnapshot(true)}>
                Retry Backup
              </Button>
            }
          />
        )}
      </OcsWizardStepCard>

      {/* ───────── Step 7 ───────── */}
      <OcsWizardStepCard
        index={7}
        title="Review and Import"
        description="검증된 패키지와 백업을 확인하고 운영 DB 에 반영합니다."
        status={steps[6]!.status}
        open={openStep === 7}
        onToggle={() => toggle(7)}
        locked={!gates.step7Unlocked}
        lockReasons={
          !gates.step7Unlocked
            ? ["Step 4~6 이 모두 통과하고 Snapshot 이 성공해야 활성화됩니다."]
            : []
        }
      >
        {dry && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold">최종 요약</div>
              <Row label="OCS files" value={dry["scope_ocs_count"]} />
              <Row label="New comments" value={dry["comments_new"]} />
              <Row label="Updated comments" value={dry["comments_to_update"]} />
              <Row label="Unchanged comments" value={dry["comments_unchanged"]} />
              <Row label="Retired comments" value={dry["comments_to_retire"]} bad={massRetire} />
              <Row label="Response segments" value={pkg?.response.segments.length ?? "—"} />
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold">자산 · 백업</div>
              <Row
                label="Images new / existing"
                value={`${num(dry["images_new"])} / ${num(dry["images_existing"])}`}
              />
              <Row
                label="Source Excel new / revised / existing"
                value={`${num(dry["source_files_new"])} / ${num(dry["source_files_revised"])} / ${num(dry["source_files_existing"])}`}
              />
              <Row
                label="Unresolved attachments"
                value={dry["attachments_unresolved"]}
                bad={num(dry["attachments_unresolved"]) > 0}
              />
              <Row label="Snapshot ID" value={snapshotId ?? "—"} />
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-600">
            {warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        )}
        {blockers.length > 0 && (
          <ul className="space-y-1 text-xs text-destructive">
            {blockers.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={approved}
            disabled={!dry || !snapshotId}
            onCheckedChange={(v) => setApproved(v === true)}
          />
          I reviewed the package check, uploaded files and backup results and approve this import.
        </label>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={
                blockers.length > 0 ||
                !!busy ||
                !!result ||
                importRunning ||
                (importFailure !== null && !importFailure.retryAllowed)
              }
            >
              {importRunning ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Importing…
                </>
              ) : importFailure?.retryAllowed ? (
                "Retry Increment Import"
              ) : (
                "Import OCS Package"
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import OCS Package</AlertDialogTitle>
              <AlertDialogDescription>
                This will update the production OCS database using the verified package and backup
                shown above. It cannot be started twice.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void runImport()}>Start Import</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {importRunning && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Loader2 className="h-3 w-3 animate-spin" /> Importing…
              <span className="font-mono text-muted-foreground">
                {Math.floor(importElapsed / 60)}m {importElapsed % 60}s
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded bg-primary" />
            </div>
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              <li>• Final server validation</li>
              <li>• Transactional OCS database import</li>
              <li>• Post-import integrity verification</li>
            </ul>
            <p className="text-xs font-medium text-amber-600">Do not refresh or close this page.</p>
          </div>
        )}
        {importFailure && (
          <OcsErrorCard
            title={importFailure.title}
            affected={importFailure.affected}
            nextStep={importFailure.nextStep}
            runId={runId}
            snapshotId={snapshotId}
            details={`status: ${importFailure.kind}${
              importFailure.stage ? `\nstage: ${importFailure.stage}` : ""
            }\n${importFailure.message}`}
          />
        )}
        {failure && !importFailure && (
          <OcsErrorCard
            title="Step failed"
            affected="이 단계만 실패했습니다. 운영 정본 반영 여부는 이 메시지로 판정하지 않습니다."
            nextStep="run ID 로 Import log 와 운영 정본을 확인한 뒤 진행하십시오."
            runId={runId}
            snapshotId={snapshotId}
            details={failure}
          />
        )}
      </OcsWizardStepCard>

      {/* ───────── Step 8 ───────── */}
      <OcsWizardStepCard
        index={8}
        title="Complete"
        description="반영 결과와 감사 증거를 확인합니다."
        status={steps[7]!.status}
        open={openStep === 8}
        onToggle={() => toggle(8)}
        locked={!result}
        lockReasons={!result ? ["Import 성공 후 표시됩니다."] : []}
      >
        {result ? (
          <div className="space-y-3">
            {importSuccess.complete ? (
              <div className="text-sm font-semibold text-emerald-600">OCS Import Completed</div>
            ) : (
              <div className="space-y-1 rounded-md border border-amber-500 p-3">
                <div className="text-sm font-semibold text-amber-600">Verification required</div>
                <p className="text-[11px] text-muted-foreground">
                  서버 Import log·post-import verify·항등식·보호 해시 대조가 모두 확인되지
                  않았습니다. 완료로 처리하지 마십시오.
                </p>
                <ul className="space-y-0.5 text-[11px] text-destructive">
                  {importSuccess.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-md border p-3">
              <Row label="Package ID" value={pkg?.manifest.package_id ?? "—"} />
              <Row label="Import run ID" value={runId} />
              <Row label="import_log_id" value={result["import_log_id"]} />
              <Row
                label="import log status"
                value={result["import_log_status"] ?? "—"}
                bad={result["import_log_status"] !== "success"}
              />
              <Row label="Snapshot ID" value={snapshotId ?? "—"} />
              {Object.entries((result["result"] ?? {}) as Record<string, unknown>)
                .filter(([, v]) => typeof v === "number" || typeof v === "string")
                .map(([k, v]) => (
                  <Row key={k} label={k} value={v} />
                ))}
            </div>
            <details className="rounded-md border bg-muted/40 p-2">
              <summary className="cursor-pointer text-[11px] font-medium">
                Technical result JSON
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto text-[11px]">
                {JSON.stringify(result["result"], null, 2)}
              </pre>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(runId ?? "");
                  toast.success("Run ID copied");
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> Copy Run ID
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/closure/abd/raw-data">
                  <ExternalLink className="mr-1 h-3 w-3" /> Open ABD Raw Data
                </Link>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Keep the original DAR files and generated package for audit. When the next DAR files
              arrive, start again from Step 1 and generate a new Baseline. 같은 package 는 다시
              실행할 수 없습니다.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">아직 완료된 Import 가 없습니다.</p>
        )}
      </OcsWizardStepCard>
    </div>
  );
}
