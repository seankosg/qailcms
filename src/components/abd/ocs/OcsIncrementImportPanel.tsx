import { useMemo, useState } from "react";
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
import { ocsV3StageLoad, ocsV3StageReset, type V3StageKind } from "@/lib/abd/ocs-v3-import.functions";
import { ocsIncDryRun, ocsIncImport, ocsIncPrecheck } from "@/lib/abd/ocs-increment.functions";
import { OcsBaselineCard } from "@/components/abd/ocs/OcsBaselineCard";
import { createPreImportSnapshot } from "@/lib/backup/backup.functions";
import { OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import { OCS_SOURCE_BUCKET } from "@/lib/abd/ocs-source-manifest";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const BATCH = 500;
const RETIRE_PCT = 0.3;
const RETIRE_ABS = 100;
/**
 * Stage 9 — Latest OCS Baseline 다운로드·검증이 구현되었다.
 * precheck 가 manifest 의 base_baseline_id / base_core_hash 를 서버 실시간 값과 대조한다.
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
  const snapshotFn = useServerFn(createPreImportSnapshot);

  const [pkg, setPkg] = useState<IncrementPackage | null>(null);
  const [precheck, setPrecheck] = useState<Record<string, unknown> | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dry, setDry] = useState<Dry | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [allowRetire, setAllowRetire] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [collision, setCollision] = useState<CollisionReport | null>(null);

  const isAdmin = me?.isStrictAdmin === true;

  const retire = num(dry?.["comments_to_retire"]);
  const scopeActive = num(dry?.["scope_existing_active"]);
  const massRetire = dry ? retire > scopeActive * RETIRE_PCT || retire > RETIRE_ABS : false;

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!pkg) out.push("증분 ZIP 패키지를 선택하십시오.");
    if (pkg) out.push(...pkg.blockers);
    if (pkg && !collision) out.push("Storage 충돌 점검 미완료");
    if (collision) out.push(...collision.blockers);
    if (precheck?.["duplicate_package"] === true) out.push("동일 패키지 해시가 이미 반영되었습니다.");
    const base = (precheck?.["baseline"] ?? {}) as Record<string, unknown>;
    if (precheck && base["base_import_run_found"] !== true) out.push("base_import_run_id 를 정본에서 찾을 수 없습니다.");
    if (precheck && base["is_latest"] !== true) out.push("Baseline 이 최신 정본 Import 가 아닙니다.");
    if (precheck && base["core_changed_since_base"] === true) out.push("Baseline 이후 OCS 정본이 변경되었습니다.");
    if (precheck && precheck["base_core_hash_match"] === false)
      out.push("manifest.base_core_hash 가 서버 정본 core hash 와 다릅니다.");
    if (precheck && precheck["baseline_id_match"] === false)
      out.push("manifest.base_baseline_id 가 서버 재계산값과 다릅니다.");
    if (precheck && Array.isArray(precheck["mismatched_core_tables"]) && (precheck["mismatched_core_tables"] as string[]).length > 0)
      out.push(`core 테이블 해시 불일치: ${(precheck["mismatched_core_tables"] as string[]).join(", ")}`);
    if (!dry) out.push("Dry-run 미실행");
    if (dry) {
      if (num(dry["comments_to_update"]) !== num(dry["comments_unchanged"]) + num(dry["comments_modified"])) {
        out.push("Dry-run 항등식 불일치");
      }
      if (num(dry["attachments_unresolved"]) > 0) out.push(`미확인 첨부 ${num(dry["attachments_unresolved"])}건`);
      if (massRetire && !allowRetire) out.push(`대량 퇴역 미승인 (${retire}건 · 임계 30% / 100건)`);
    }
    if (!snapshotId) out.push("사전 백업 스냅샷 미완료 (Dry-run 이후 생성분만 인정)");
    if (!approved) out.push("최종 승인 체크 필요");
    return out;
  }, [pkg, precheck, dry, snapshotId, approved, massRetire, allowRetire, retire, collision]);

  function resetDownstream() {
    setRunId(null);
    setDry(null);
    setSnapshotId(null);
    setApproved(false);
    setAllowRetire(false);
    setResult(null);
    setFailure(null);
  }

  async function onPick(files: FileList) {
    const file = files[0];
    if (!file) return;
    setBusy("패키지 검증 중…");
    resetDownstream();
    setPrecheck(null);
    setCollision(null);
    try {
      const p = await readIncrementPackage(file);
      setPkg(p);
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
    } finally {
      setBusy(null);
    }
  }

  async function stage(run: string, kind: V3StageKind, rows: unknown[], base: number, span: number) {
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
    if (!dry) return;
    setBusy("사전 백업 스냅샷 생성 중…");
    try {
      const res = (await snapshotFn({ data: { module: "abd" } })) as { id?: string } | null;
      if (!res?.id) throw new Error("스냅샷 ID 를 확인하지 못했습니다.");
      setSnapshotId(res.id);
      toast.success("사전 백업 스냅샷 생성 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** source/ 와 images/ 를 비공개 보관함에 보존 업로드 (upsert:false · 기존 파일 미덮어쓰기) */
  async function uploadAssets(p: IncrementPackage) {
    const skip = collision?.skipPaths ?? new Set<string>();
    for (const img of p.images) {
      const path = imageStoragePath(img.relative_path);
      if (skip.has(path)) continue;
      const { error } = await supabase.storage
        .from(OCS_BUCKET)
        .upload(path, new Blob([img.bytes]), { upsert: false });
      if (error && !/exists/i.test(error.message)) throw new Error(`이미지 업로드 실패 ${path}: ${error.message}`);
    }
    for (const sf of p.sourceFiles) {
      const fileName = sf.relative_path.split("/").pop() ?? sf.relative_path;
      const storagePath = sourceStoragePath(p.manifest.package_id, sf.relative_path);
      if (skip.has(storagePath)) continue;
      const { error } = await supabase.storage
        .from(OCS_SOURCE_BUCKET)
        .upload(storagePath, new Blob([sf.bytes]), { upsert: false });
      if (error && !/exists/i.test(error.message)) throw new Error(`원본 업로드 실패 ${fileName}: ${error.message}`);
      const { error: insErr } = await supabase.from("abd_ocs_source_files").insert({
        source_file_id: sf.sha256,
        file_name: fileName,
        relative_path: sf.relative_path,
        storage_path: storagePath,
        content_hash: sf.sha256,
        byte_size: sf.byte_size,
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      if (insErr && !/duplicate key/i.test(insErr.message)) {
        throw new Error(`원본 등록 실패 ${fileName}: ${insErr.message}`);
      }
    }
  }

  async function runImport() {
    if (!pkg || !runId || !snapshotId || blockers.length > 0) return;
    setBusy("증분 Import 실행 중…");
    try {
      await uploadAssets(pkg);
      const out = (await importFn({
        data: {
          run_id: runId,
          snapshot_id: snapshotId,
          package_name: pkg.file_name,
          package_sha256: pkg.package_sha256,
          manifest_name: "manifest.json",
          manifest_hash: pkg.package_sha256,
          data_date: pkg.manifest.data_date,
          base_import_run_id: pkg.manifest.base_import_run_id,
          base_baseline_id: pkg.manifest.base_baseline_id,
          allow_retire: allowRetire,
          source_files: pkg.sourceFiles.map((f) => ({
            file_name: f.relative_path.split("/").pop() ?? f.relative_path,
            content_hash: f.sha256,
          })),
        },
      })) as Record<string, unknown>;
      setResult(out);
      toast.success("증분 Import 완료");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
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
          <AlertTriangle className="h-4 w-4 text-destructive" />
          이 화면은 관리자(admin) 전용입니다.
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
          <FilePickerButton
            label="Select Increment ZIP"
            accept=".zip,application/zip"
            disabled={!!busy}
            onFiles={(f) => void onPick(f)}
          />

          {pkg && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-1 text-xs font-semibold">패키지</div>
                <Row label="파일명" value={pkg.file_name} />
                <Row label="package_id" value={pkg.manifest.package_id} />
                <Row label="Data Date" value={pkg.manifest.data_date} bad={!pkg.manifest.data_date} />
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
              Run Dry-run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dry || !!busy}
              onClick={() => void runSnapshot()}
            >
              Create Pre-import Snapshot
            </Button>
            {snapshotId && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> snapshot {snapshotId.slice(0, 8)}
              </Badge>
            )}
          </div>

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
              동일 <code>storage_path</code> 존재 시 DB metadata 의 <code>content_hash</code> 와 manifest SHA-256 을
              대조합니다. overwrite·삭제는 수행하지 않습니다.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-3 md:grid-cols-4">
              <Row label="new" value={collision.counts.new} />
              <Row label="existing (skip)" value={collision.counts.existing} />
              <Row label="hash_mismatch" value={collision.counts.hash_mismatch} bad={collision.counts.hash_mismatch > 0} />
              <Row label="unresolved" value={collision.counts.unresolved} bad={collision.counts.unresolved > 0} />
            </div>
            {collision.rows.filter((r) => r.state === "hash_mismatch" || r.state === "unresolved").length > 0 && (
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
              퇴역 예정 {retire}건이 임계(범위 내 active의 <b>30%</b> 또는 <b>100건</b>)를 넘었습니다. 목록을
              내려받아 확인한 뒤에만 승인할 수 있습니다.
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
            disabled={blockers.length > 0 || !!busy || !!result}
            onClick={() => void runImport()}
          >
            Run Increment Import
          </Button>
          {failure && (
            <div className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">
              실패: {failure}
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
