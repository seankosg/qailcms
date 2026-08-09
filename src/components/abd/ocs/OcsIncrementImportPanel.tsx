import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createPreImportSnapshot, getBackupRunStatus } from "@/lib/backup/backup.functions";
import { OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import { OCS_SOURCE_BUCKET } from "@/lib/abd/ocs-source-manifest";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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

  const [pkg, setPkg] = useState<IncrementPackage | null>(null);
  const [precheck, setPrecheck] = useState<Record<string, unknown> | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dry, setDry] = useState<Dry | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [snapshotRunning, setSnapshotRunning] = useState(false);
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
  const [collision, setCollision] = useState<CollisionReport | null>(null);
  const [receipts, setReceipts] = useState<UploadReceipt[]>([]);
  const [verifyTotal, setVerifyTotal] = useState(0);
  const [verifyOk, setVerifyOk] = useState<string[]>([]);
  const [verifyFailures, setVerifyFailures] = useState<{ path: string; error: string }[]>([]);
  const [verifyRan, setVerifyRan] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const isAdmin = me?.isStrictAdmin === true;

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
  const verifyPending = Math.max(0, verifyTotal - verifyOk.length);
  const verifyComplete =
    verifyRan &&
    uploadFailedCount === 0 &&
    verifyFailures.length === 0 &&
    verifyTotal === newAssetTotal &&
    verifyPending === 0;

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

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!BASELINE_VERIFICATION_IMPLEMENTED) {
      out.push("Baseline 실측 검증(생성·다운로드·내용 대조) 미완료 — 증분 Import 잠금");
    }
    if (!pkg) out.push("증분 ZIP 패키지를 선택하십시오.");
    if (pkg) out.push(...pkg.blockers);
    if (pkg && !collision) out.push("Storage 충돌 점검 미완료");
    if (collision) out.push(...collision.blockers);
    if (precheck?.["duplicate_package"] === true)
      out.push("동일 패키지 해시가 이미 반영되었습니다.");
    const base = (precheck?.["baseline"] ?? {}) as Record<string, unknown>;
    if (precheck && base["base_import_run_found"] !== true)
      out.push("base_import_run_id 를 정본에서 찾을 수 없습니다.");
    if (precheck && base["is_latest"] !== true)
      out.push("Baseline 이 최신 정본 Import 가 아닙니다.");
    if (precheck && base["core_changed_since_base"] === true && !baselineIdentityOk)
      out.push("Baseline 이후 OCS 정본이 변경되었습니다.");
    if (precheck && precheck["base_core_hash_match"] === false)
      out.push("manifest.base_core_hash 가 서버 정본 core hash 와 다릅니다.");
    if (precheck && precheck["baseline_id_match"] === false)
      out.push("manifest.base_baseline_id 가 서버 재계산값과 다릅니다.");
    if (
      precheck &&
      Array.isArray(precheck["mismatched_core_tables"]) &&
      (precheck["mismatched_core_tables"] as string[]).length > 0
    )
      out.push(
        `core 테이블 해시 불일치: ${(precheck["mismatched_core_tables"] as string[]).join(", ")}`,
      );
    if (!dry) out.push("Dry-run 미실행");
    if (dry) {
      if (
        num(dry["comments_to_update"]) !==
        num(dry["comments_unchanged"]) + num(dry["comments_modified"])
      ) {
        out.push("Dry-run 항등식 불일치");
      }
      if (num(dry["attachments_unresolved"]) > 0)
        out.push(`미확인 첨부 ${num(dry["attachments_unresolved"])}건`);
      if (massRetire && !allowRetire) out.push(`대량 퇴역 미승인 (${retire}건 · 임계 30% / 100건)`);
    }
    if (!snapshotId) out.push("사전 백업 스냅샷 미완료 (Dry-run 이후 생성분만 인정)");
    if (uploadFailedCount > 0)
      out.push(
        `자산 업로드 실패 ${uploadFailedCount}건 — 재실행으로 실패분만 다시 업로드하십시오.`,
      );
    if (!verifyComplete)
      out.push(
        !verifyRan
          ? "신규 자산 업로드 · 서버 실측 검증 미실행"
          : `서버 실측 검증 미완료 (${verifyOk.length}/${newAssetTotal})`,
      );
    if (!approved) out.push("최종 승인 체크 필요");
    return out;
  }, [
    pkg,
    precheck,
    dry,
    snapshotId,
    approved,
    massRetire,
    allowRetire,
    retire,
    collision,
    verifyComplete,
    verifyTotal,
    verifyOk.length,
    verifyRan,
    newAssetTotal,
    uploadFailedCount,
    baselineIdentityOk,
  ]);

  function resetDownstream() {
    setRunId(null);
    setDry(null);
    setSnapshotId(null);
    setApproved(false);
    setAllowRetire(false);
    setResult(null);
    setFailure(null);
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
      const col = await checkPackageStorageCollisions(p);
      setCollision(col);
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

  async function runSnapshot() {
    if (!dry || snapshotRunning) return;
    const runId = crypto.randomUUID();
    const started = Date.now();
    setSnapshotRunning(true);
    setSnapshotError(null);
    setSnapshotStatus(null);
    setSnapshotElapsed(0);

    const tick = setInterval(() => setSnapshotElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const poll = setInterval(() => {
      void (async () => {
        try {
          const row = (await snapshotStatusFn({ data: { run_id: runId } })) as
            | { metadata?: Record<string, unknown> | null }
            | null;
          const m = (row?.metadata ?? null) as Record<string, unknown> | null;
          if (!m) return;
          setSnapshotStatus({
            tablesTotal: num(m["tables_total"]),
            tablesDone: num(m["tables_done"]),
            currentTable: (m["current_table"] as string | null) ?? null,
            sizeBytes: m["size_bytes"] == null ? null : num(m["size_bytes"]),
          });
        } catch {
          /* 진행 상태 조회 실패는 스냅샷 자체에 영향 없음 */
        }
      })();
    }, 3000);

    try {
      const res = (await snapshotFn({ data: { module: "abd", run_id: runId } })) as
        | { id?: string; size_bytes?: number }
        | null;
      if (!res?.id) throw new Error("스냅샷 ID 를 확인하지 못했습니다.");
      setSnapshotId(res.id);
      setSnapshotStatus((prev) => ({
        tablesTotal: prev?.tablesTotal ?? 0,
        tablesDone: prev?.tablesTotal ?? prev?.tablesDone ?? 0,
        currentTable: null,
        sizeBytes: res.size_bytes ?? prev?.sizeBytes ?? null,
      }));
      toast.success(`Snapshot created — ${res.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSnapshotError(msg);
      toast.error(msg);
    } finally {
      clearInterval(tick);
      clearInterval(poll);
      setSnapshotRunning(false);
    }
  }

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
      toast.success(`Import completed — run ${runId}`);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setImportFailStage("Transactional OCS database import");
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
          <AlertTriangle className="h-4 w-4 text-destructive" />이 화면은 관리자(admin) 전용입니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <OcsBaselineCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageOpen className="h-4 w-4" /> ABD OCS 정규 증분 Import
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            DAR 신규·개정 OCS 를 로컬에서 완성한 단일 ZIP 패키지로 반영합니다. 파일명 계약:{" "}
            <code>OCS_Increment_&lt;YYYYMMDD&gt;_&lt;seq&gt;.zip</code>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilePickerButton
              label={pkg ? "Change Increment ZIP" : "Select Increment ZIP"}
              accept=".zip,application/zip"
              disabled={!!busy}
              inputRef={fileInputRef}
              resetKey={pickerKey}
              onFiles={(f) => void onPick(f)}
            />
            {(pkg || failure) && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={clearPick}>
                Clear
              </Button>
            )}
            {stageLabel && (
              <Badge variant="outline" className="text-[11px]">
                {stageLabel}
              </Badge>
            )}
          </div>

          {pkg && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">패키지</div>
                <Row label="파일명" value={pkg.file_name} />
                <Row label="package_id" value={pkg.manifest.package_id} />
                <Row
                  label="Data Date"
                  value={pkg.manifest.data_date}
                  bad={!pkg.manifest.data_date}
                />
                <Row label="Baseline ID" value={pkg.manifest.base_baseline_id} />
                <Row label="Base Import Run" value={pkg.manifest.base_import_run_id} />
                <Row label="대상 OCS 수" value={pkg.manifest.target_ocs_numbers.length} />
                <Row label="구분" value={pkg.manifest.change_type} />
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">내부 파일 검증</div>
                <Row label="manifest files" value={pkg.manifest.files.length} />
                <Row label="SHA-256 일치" value={pkg.verifiedFiles} />
                <Row label="source/*.xlsx" value={pkg.sourceFiles.length} />
                <Row label="images/*" value={pkg.images.length} />
                <Row label="atomic rows" value={pkg.atomic.comments.length} />
                <Row label="package SHA-256" value={pkg.package_sha256.slice(0, 16)} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!pkg || !!busy} onClick={() => void runDryRun()}>
              1. Run Dry-run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!pkg || !dry || !!busy || !!result}
              onClick={() => void runUploadVerify()}
            >
              {uploadFailedCount > 0
                ? `2. Retry Failed Uploads (${uploadFailedCount})`
                : verifyFailures.length > 0
                  ? "2. Retry Failed Verification"
                  : "2. Upload & Verify Assets"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dry || !verifyComplete || !!busy || snapshotRunning}
              onClick={() => void runSnapshot()}
            >
              {snapshotRunning ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 3. Creating Snapshot…
                </>
              ) : snapshotError ? (
                "3. Retry Pre-import Snapshot"
              ) : (
                "3. Create Pre-import Snapshot"
              )}
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
            {snapshotId && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> snapshot{" "}
                {snapshotId.slice(0, 8)}
              </Badge>
            )}
          </div>

          {snapshotRunning && (
            <div className="space-y-1 rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Loader2 className="h-3 w-3 animate-spin" /> 3. Creating Snapshot…
                <span className="font-mono text-muted-foreground">
                  {Math.floor(snapshotElapsed / 60)}m {snapshotElapsed % 60}s
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Backing up ABD and OCS tables. This may take several minutes. Do not navigate away
                or refresh this page.
              </p>
              {snapshotStatus && snapshotStatus.tablesTotal > 0 && (
                <>
                  <div className="text-xs text-muted-foreground">
                    tables {snapshotStatus.tablesDone}/{snapshotStatus.tablesTotal}
                    {snapshotStatus.currentTable ? ` — ${snapshotStatus.currentTable}` : ""}
                  </div>
                  <Progress
                    value={(snapshotStatus.tablesDone / snapshotStatus.tablesTotal) * 100}
                  />
                </>
              )}
            </div>
          )}

          {snapshotId && !snapshotRunning && (
            <div className="rounded-md border p-3 text-xs">
              <div className="font-medium text-emerald-600">Snapshot created</div>
              <div className="font-mono text-muted-foreground">
                {snapshotId}
                {snapshotStatus?.sizeBytes
                  ? ` · ${(snapshotStatus.sizeBytes / 1024 / 1024).toFixed(2)} MB`
                  : ""}
              </div>
            </div>
          )}

          {snapshotError && !snapshotRunning && (
            <div className="space-y-2 rounded-md border border-destructive/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> Snapshot failed
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-destructive">
                {snapshotError}
              </pre>
              <p className="text-xs text-muted-foreground">
                Uploaded assets are kept. Only the snapshot step needs to be retried.
              </p>
              <Button size="sm" variant="outline" onClick={() => void runSnapshot()}>
                Retry Snapshot
              </Button>
            </div>
          )}

          {busy && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {busy}
              </div>
              {progress > 0 && <Progress value={progress} />}
            </div>
          )}
        </CardContent>
      </Card>

      {dry && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dry-run 결과 (운영 데이터 변경 없음)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
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
              <Row label="comments_to_retire" value={dry["comments_to_retire"]} bad={massRetire} />
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
              <div className="mb-1 text-xs font-semibold">범위 밖 보호 해시 (Import 전후 대조)</div>
              <Row label="comments hash" value={dry["outside_scope_comment_hash_before"]} />
              <Row label="links hash" value={dry["outside_scope_link_hash_before"]} />
            </div>
          </CardContent>
        </Card>
      )}

      {collision && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storage 충돌 점검 (읽기 전용)</CardTitle>
            <p className="text-xs text-muted-foreground">
              동일 <code>storage_path</code> 존재 시 DB metadata 의 <code>content_hash</code> 와
              manifest SHA-256 을 대조합니다. overwrite·삭제는 수행하지 않습니다.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
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
              <div className="max-h-56 overflow-auto rounded-md border p-2 text-[11px]">
                {collision.rows
                  .filter((r) => r.state === "hash_mismatch" || r.state === "unresolved")
                  .map((r) => (
                    <div key={`${r.bucket}/${r.path}`} className="font-mono text-destructive">
                      [{r.state}] {r.bucket}/{r.path}
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {dry && massRetire && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> 대량 퇴역 차단
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              퇴역 예정 {retire}건이 임계(범위 내 active의 <b>30%</b> 또는 <b>100건</b>)를
              넘었습니다. 목록을 내려받아 확인한 뒤에만 승인할 수 있습니다.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allowRetire} onCheckedChange={(v) => setAllowRetire(v === true)} />
              Allow retire — 퇴역 {retire}건을 확인했습니다
            </label>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> 실행
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={approved}
              disabled={!dry || !snapshotId}
              onCheckedChange={(v) => setApproved(v === true)}
            />
            Dry-run 결과와 백업을 확인했고 증분 Import 를 승인합니다
          </label>
          <Button
            size="sm"
            disabled={blockers.length > 0 || !!busy || !!result || importRunning}
            onClick={() => void runImport()}
          >
            {importRunning ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Importing…
              </>
            ) : failure ? (
              "Retry Increment Import"
            ) : (
              "Run Increment Import"
            )}
          </Button>
          {importRunning && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Loader2 className="h-3 w-3 animate-spin" /> Importing…
                <span className="font-mono text-muted-foreground">
                  {Math.floor(importElapsed / 60)}m {importElapsed % 60}s
                </span>
              </div>
              {/* 단일 원자적 RPC 트랜잭션이므로 내부 단계 전환을 관측할 수 없다.
                  백분율 대신 indeterminate 표시와 경과시간만 노출한다. */}
              <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded bg-primary" />
              </div>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                <li>• Final server validation</li>
                <li>• Transactional OCS database import</li>
                <li>• Post-import integrity verification</li>
              </ul>
              <p className="text-xs font-medium text-amber-600">
                Do not refresh or close this page.
              </p>
            </div>
          )}
          {result && !importRunning && (
            <div className="rounded-md border p-3 text-xs">
              <div className="font-medium text-emerald-600">Import completed</div>
              <div className="font-mono text-muted-foreground">run {runId}</div>
            </div>
          )}
          {failure && (
            <div className="space-y-2 rounded-md border border-destructive/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> Import failed
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                run {runId ?? "—"}
                {importFailStage ? ` · stage: ${importFailStage}` : ""}
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-destructive">
                {failure}
              </pre>
              <p className="text-[11px] text-muted-foreground">
                The import runs in a single transaction — a failure leaves no partial data. Uploaded
                assets and the pre-import snapshot are kept; retry the import step only.
              </p>
            </div>
          )}
          {receipts.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold">
                업로드 영수증 (uploaded {receipts.filter((r) => r.state === "uploaded").length} ·
                existing {receipts.filter((r) => r.state === "existing").length} · failed{" "}
                {receipts.filter((r) => r.state === "failed").length})
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                실패분은 자동 삭제하지 않습니다. 동일 ZIP 을 다시 선택하면 이미 올라간 object 는
                건너뛰고 실패분만 재시도합니다.
              </p>
              <div className="max-h-40 overflow-auto text-[11px] font-mono">
                {receipts
                  .filter((r) => r.state === "failed")
                  .map((r) => (
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
                서버가 각 object 를 직접 내려받아 SHA-256·byte_size 를 실측합니다. 최종 Import 는
                클라이언트 영수증이 아니라 이 서버 검증 영수증을 정본으로 사용합니다.
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
          {result && (
            <div className="rounded-md border p-3">
              <Row label="import_log_id" value={result["import_log_id"]} />
              <Row label="run" value={runId} />
              <pre className="mt-2 max-h-64 overflow-auto text-[11px]">
                {JSON.stringify(result["result"], null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
