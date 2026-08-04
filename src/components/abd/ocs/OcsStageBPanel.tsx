import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, DatabaseZap, FileJson, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  attachRowHashes,
  chunk,
  parseOcsCommentJson,
  sha256Hex,
  type OcsCommentParse,
  type OcsCommentRow,
} from "@/lib/abd/ocs-db-parser";
import { extOf, mimeForExt, parseOcsManifest, type OcsManifestParse } from "@/lib/abd/ocs-manifest";
import { OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import { listBucketPaths } from "@/lib/abd/ocs-storage";
import {
  OCS_IMPORT_BUCKET,
  createOcsImportLog,
  ocsDryRunBatch,
  ocsFinalizeComments,
  ocsImportAttachmentBatch,
  ocsImportCommentBatch,
  ocsVerify,
  updateOcsImportLog,
} from "@/lib/abd/ocs-stage-b.functions";
import { createPreImportSnapshot } from "@/lib/backup/backup.functions";

const BATCH = 200;

type DryRun = {
  total: number;
  new: number;
  updated: number;
  unchanged: number;
  linked: number;
  unmatched: number;
  mismatch: number;
  bp42c: number;
  team_mech: number;
  team_elec: number;
  team_null: number;
  new_a: number;
  new_a_linked: number;
  unique_abd: number;
  storage_missing: number;
  storage_orphan: number;
  att_linked: number;
  att_needs_review: number;
};

const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export function OcsStageBPanel() {
  const dryRunFn = useServerFn(ocsDryRunBatch);
  const createLog = useServerFn(createOcsImportLog);
  const patchLog = useServerFn(updateOcsImportLog);
  const importComments = useServerFn(ocsImportCommentBatch);
  const importAttachments = useServerFn(ocsImportAttachmentBatch);
  const finalize = useServerFn(ocsFinalizeComments);
  const verify = useServerFn(ocsVerify);
  const snapshotFn = useServerFn(createPreImportSnapshot);

  const [dataFile, setDataFile] = useState<{ name: string; hash: string; text: string } | null>(null);
  const [manifestFile, setManifestFile] = useState<{ name: string; hash: string; text: string } | null>(null);
  const [comments, setComments] = useState<OcsCommentParse | null>(null);
  const [rows, setRows] = useState<OcsCommentRow[]>([]);
  const [manifest, setManifest] = useState<OcsManifestParse | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [failedBatches, setFailedBatches] = useState<string[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const storageRef = useRef<string[] | null>(null);

  async function onDataFile(f: File) {
    try {
      setBusy("데이터 JSON 파싱 중…");
      const text = await f.text();
      const parsed = parseOcsCommentJson(JSON.parse(text));
      if (parsed.rows.length === 0) throw new Error("rows 배열이 비어 있습니다.");
      const withHash = await attachRowHashes(parsed.rows);
      setDataFile({ name: f.name, hash: await sha256Hex(text), text });
      setComments(parsed);
      setRows(withHash);
      setDry(null);
      setApproved(false);
      toast.success(`코멘트 ${parsed.rows.length}건 읽음`);
    } catch (e) {
      toast.error(`데이터 JSON 읽기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onManifestFile(f: File) {
    try {
      const text = await f.text();
      const parsed = parseOcsManifest(JSON.parse(text));
      setManifestFile({ name: f.name, hash: await sha256Hex(text), text });
      setManifest(parsed);
      setDry(null);
      setApproved(false);
      toast.success(`첨부 대상 ${parsed.entries.length}건 읽음`);
    } catch (e) {
      toast.error(`매니페스트 읽기 실패: ${(e as Error).message}`);
    }
  }

  const crossCheck = useMemo(() => {
    if (!comments || !manifest) return null;
    const ids = new Set(rows.map((r) => r.source_comment_id));
    let refFound = 0;
    let refMissing = 0;
    let noRef = 0;
    for (const e of manifest.entries) {
      if (!e.source_comment_id) noRef += 1;
      else if (ids.has(e.source_comment_id)) refFound += 1;
      else refMissing += 1;
    }
    return { refFound, refMissing, noRef };
  }, [comments, manifest, rows]);

  async function onDryRun() {
    if (!comments || !manifest) return;
    try {
      setBusy("사전점검(dry-run) 실행 중…");
      setProgress(0);
      const agg: DryRun = {
        total: 0, new: 0, updated: 0, unchanged: 0, linked: 0, unmatched: 0, mismatch: 0,
        bp42c: 0, team_mech: 0, team_elec: 0, team_null: 0, new_a: 0, new_a_linked: 0,
        unique_abd: 0, storage_missing: 0, storage_orphan: 0, att_linked: 0, att_needs_review: 0,
      };
      const abdIds = new Set<string>();
      const batches = chunk(rows, BATCH);
      for (let i = 0; i < batches.length; i += 1) {
        const res = (await dryRunFn({
          data: {
            rows: batches[i]!.map((r) => ({
              source_comment_id: r.source_comment_id,
              drawing_number_norm: r.drawing_number_norm,
              ocs_number_norm: r.ocs_number_norm,
              assessed_code: r.assessed_code,
              source_row_hash: r.source_row_hash,
            })),
          },
        })) as Record<string, unknown>;
        for (const k of ["total","new","updated","unchanged","linked","unmatched","mismatch","bp42c","team_mech","team_elec","team_null","new_a","new_a_linked"] as const) {
          agg[k] += numOf(res[k]);
        }
        for (const id of (res["abd_ids"] as string[] | undefined) ?? []) abdIds.add(id);
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }
      agg.unique_abd = abdIds.size;

      // Storage 전수 대조 (Stage A1 업로드 결과)
      const roots = Array.from(
        new Set(manifest.entries.map((e) => e.relative_path.split("/")[0]).filter(Boolean) as string[]),
      );
      const storage = new Set(await listBucketPaths(OCS_BUCKET, roots));
      storageRef.current = Array.from(storage);
      const manifestPaths = new Set(manifest.entries.map((e) => e.relative_path));
      agg.storage_missing = manifest.entries.filter((e) => !storage.has(e.relative_path)).length;
      agg.storage_orphan = Array.from(storage).filter((p) => !manifestPaths.has(p)).length;

      const commentIds = new Set(rows.map((r) => r.source_comment_id));
      agg.att_linked = manifest.entries.filter(
        (e) => e.source_comment_id && commentIds.has(e.source_comment_id),
      ).length;
      agg.att_needs_review = manifest.entries.length - agg.att_linked;

      setDry(agg);
      toast.success("사전점검 완료 — 수치를 확인하십시오.");
    } catch (e) {
      toast.error(`사전점검 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (comments) {
      if (comments.duplicated_comment_ids.length) out.push(`Comment ID 중복 ${comments.duplicated_comment_ids.length}건`);
      if (comments.missing_comment_id) out.push(`Comment ID 누락 ${comments.missing_comment_id}건`);
    }
    if (manifest) {
      if (manifest.duplicated_attachment_ids.length) out.push(`attachment_id 중복 ${manifest.duplicated_attachment_ids.length}건`);
      if (manifest.duplicated_paths.length) out.push(`첨부 경로 중복 ${manifest.duplicated_paths.length}건`);
      if (manifest.invalid_rows.length) out.push(`첨부 형식/용량 오류 ${manifest.invalid_rows.length}건`);
    }
    if (crossCheck?.refMissing) out.push(`코멘트에 없는 첨부 참조 ${crossCheck.refMissing}건`);
    if (dry && dry.storage_missing > 0) out.push(`Storage 누락 ${dry.storage_missing}건`);
    if (!snapshotId) out.push("사전 백업 스냅샷 미확인");
    return out;
  }, [comments, manifest, crossCheck, dry, snapshotId]);

  async function onSnapshot() {
    try {
      setBusy("사전 백업 스냅샷 생성 중… (수 분 소요될 수 있습니다)");
      const res = (await snapshotFn({ data: { module: "abd" } })) as { snapshotId?: string; snapshot_id?: string };
      const id = res?.snapshotId ?? res?.snapshot_id ?? null;
      if (!id) throw new Error("스냅샷 ID를 확인하지 못했습니다.");
      setSnapshotId(id);
      toast.success("사전 백업 성공 — Import 가능");
    } catch (e) {
      setSnapshotId(null);
      toast.error(`사전 백업 실패 — Import 차단: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onImport() {
    if (!dataFile || !manifestFile || !manifest || !dry || !snapshotId) return;
    setFailedBatches([]);
    let logId: string | null = null;
    try {
      setBusy("원본 JSON 보존 중…");
      const log = await createLog({
        data: {
          data_file_name: dataFile.name,
          data_file_hash: dataFile.hash,
          manifest_name: manifestFile.name,
          manifest_hash: manifestFile.hash,
          total_count: rows.length,
          attachment_total: manifest.entries.length,
          snapshot_id: snapshotId,
          dryrun: dry as unknown as Record<string, unknown>,
        },
      });
      logId = log.id;

      const dataPath = `${logId}/${dataFile.name}`;
      const manPath = `${logId}/${manifestFile.name}`;
      for (const [path, payload] of [
        [dataPath, dataFile.text],
        [manPath, manifestFile.text],
      ] as const) {
        const { error } = await supabase.storage
          .from(OCS_IMPORT_BUCKET)
          .upload(path, new Blob([payload], { type: "application/json" }), {
            contentType: "application/json",
            upsert: false,
          });
        if (error) throw new Error(`원본 JSON 보존 실패(${path}): ${error.message}`);
      }
      await patchLog({
        data: { id: logId, patch: { status: "running", storage_data_path: dataPath, storage_manifest_path: manPath } },
      });

      // 1) 코멘트
      setBusy("코멘트 등록 중…");
      setProgress(0);
      const totals = { inserted: 0, updated: 0, unchanged: 0, linked: 0, unmatched: 0, mismatch: 0, bp42c: 0, compliance_inserted: 0 };
      const cBatches = chunk(rows, BATCH);
      for (let i = 0; i < cBatches.length; i += 1) {
        try {
          const res = (await importComments({ data: { import_log_id: logId, rows: cBatches[i]! } })) as Record<string, unknown>;
          for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += numOf(res[k]);
        } catch (e) {
          setFailedBatches((p) => [...p, `코멘트 배치 #${i + 1}: ${(e as Error).message}`]);
          throw new Error(`코멘트 배치 #${i + 1} 실패 — 마감(inactive) 처리를 실행하지 않았습니다.`);
        }
        setProgress(Math.round(((i + 1) / cBatches.length) * 100));
      }

      // 2) 첨부
      setBusy("첨부 메타데이터 등록 중…");
      setProgress(0);
      const att = { inserted: 0, updated: 0, unchanged: 0, linked: 0, needs_review: 0 };
      const conflicts: unknown[] = [];
      const aRows = manifest.entries.map((e) => ({
        source_attachment_id: e.source_attachment_id,
        source_comment_id: e.source_comment_id,
        storage_path: e.relative_path,
        content_hash: e.content_hash,
        byte_size: e.byte_size,
        width: e.width,
        height: e.height,
        image_format: e.image_format,
        mime_type: mimeForExt(extOf(e.relative_path)),
        source_image_index: e.source_image_index,
      }));
      const aBatches = chunk(aRows, BATCH);
      for (let i = 0; i < aBatches.length; i += 1) {
        try {
          const res = (await importAttachments({ data: { rows: aBatches[i]! } })) as Record<string, unknown>;
          for (const k of Object.keys(att) as (keyof typeof att)[]) att[k] += numOf(res[k]);
          for (const c of (res["conflicts"] as unknown[] | undefined) ?? []) conflicts.push(c);
        } catch (e) {
          setFailedBatches((p) => [...p, `첨부 배치 #${i + 1}: ${(e as Error).message}`]);
          throw new Error(`첨부 배치 #${i + 1} 실패`);
        }
        setProgress(Math.round(((i + 1) / aBatches.length) * 100));
      }

      // 3) 마감 — 전체 코멘트 배치 성공 후에만
      setBusy("마감 처리 중…");
      const fin = (await finalize({ data: { source_ids: rows.map((r) => r.source_comment_id) } })) as Record<string, unknown>;

      // 4) 검증
      setBusy("최종 검증 중…");
      const ver = (await verify({})) as Record<string, unknown>;
      const dbPaths = new Set(((ver["storage_paths"] as string[] | undefined) ?? []));
      const storage = new Set(storageRef.current ?? []);
      const missing = Array.from(dbPaths).filter((p) => !storage.has(p)).length;
      const orphan = Array.from(storage).filter((p) => !dbPaths.has(p)).length;
      const hashMismatch = manifest.entries.filter((e) => e.content_hash == null).length;

      await patchLog({
        data: {
          id: logId,
          patch: {
            status: "success",
            finished_at: new Date().toISOString(),
            inserted_count: totals.inserted,
            updated_count: totals.updated,
            unchanged_count: totals.unchanged,
            linked_count: totals.linked,
            unmatched_count: totals.unmatched,
            inactivated_count: numOf(fin["inactivated"]),
            compliance_inserted_count: totals.compliance_inserted,
            mismatch_warning_count: totals.mismatch,
            manual_review_count: totals.bp42c,
            attachment_registered: att.inserted + att.updated + att.unchanged,
            attachment_linked: att.linked,
            attachment_needs_review: att.needs_review,
            attachment_missing_storage: missing,
            attachment_orphan_storage: orphan,
            error_count: conflicts.length,
            errors: conflicts.length ? { attachment_conflicts: conflicts } : null,
            warnings: { hash_missing_in_manifest: hashMismatch },
          },
        },
      });
      setResult({ ...totals, ...att, ...fin, verify: ver, storage_missing: missing, storage_orphan: orphan, conflicts: conflicts.length });
      toast.success("Stage B import 완료");
    } catch (e) {
      if (logId) {
        await patchLog({
          data: { id: logId, patch: { status: "failed", finished_at: new Date().toISOString(), errors: { message: (e as Error).message } } },
        }).catch(() => undefined);
      }
      toast.error(`Import 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const canImport = !!dry && blockers.length === 0 && approved && !busy;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseZap className="h-4 w-4" /> Stage B — 코멘트 Import · 도면 Link · 첨부 Metadata
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileJson className="h-4 w-4" /> 1. OCS DB Data JSON
            </div>
            <input
              type="file"
              accept="application/json,.json"
              className="block text-sm"
              onChange={(e) => e.target.files?.[0] && onDataFile(e.target.files[0])}
            />
            {comments && (
              <div className="text-xs text-muted-foreground">
                <Badge variant="secondary">{dataFile?.name}</Badge> rows {comments.total_raw} / 유효{" "}
                {comments.rows.length} / 중복 ID {comments.duplicated_comment_ids.length} / ID 누락{" "}
                {comments.missing_comment_id}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileJson className="h-4 w-4" /> 2. Attachment Manifest JSON
            </div>
            <input
              type="file"
              accept="application/json,.json"
              className="block text-sm"
              onChange={(e) => e.target.files?.[0] && onManifestFile(e.target.files[0])}
            />
            {manifest && (
              <div className="text-xs text-muted-foreground">
                <Badge variant="secondary">{manifestFile?.name}</Badge> raw {manifest.total_raw} / 등록대상{" "}
                {manifest.entries.length} / needs_review {manifest.needs_review}
              </div>
            )}
          </div>
        </div>

        {crossCheck && (
          <div className="rounded-md border p-3 text-sm">
            교차참조 — 코멘트 매칭 {crossCheck.refFound} / 코멘트에 없음 {crossCheck.refMissing} / comment_id 없음{" "}
            {crossCheck.noRef}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onDryRun} disabled={!comments || !manifest || !!busy} variant="secondary">
            {busy?.startsWith("사전점검") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            3. 사전점검(dry-run) 실행 — DB 변경 없음
          </Button>
          <Button onClick={onSnapshot} disabled={!dry || !!busy} variant="outline">
            {busy?.startsWith("사전 백업") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            4. 사전 백업 스냅샷 생성
          </Button>
          {snapshotId && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> snapshot {snapshotId.slice(0, 8)}… 성공
            </span>
          )}
        </div>
        {busy && <Progress value={progress} />}

        {dry && (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>구분</TableHead>
                  <TableHead className="text-right">수치</TableHead>
                  <TableHead className="text-right">기준값</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["JSON comments", dry.total, 1955],
                    ["신규 / 변경 / 불변", `${dry.new} / ${dry.updated} / ${dry.unchanged}`, "—"],
                    ["exact linked / unmatched", `${dry.linked} / ${dry.unmatched}`, "1,698 / 257"],
                    ["linked unique ABD", dry.unique_abd, 880],
                    ["OCS mismatch warning", dry.mismatch, 52],
                    ["BP42C manual priority", dry.bp42c, "—"],
                    ["team MECH / ELEC / NULL", `${dry.team_mech} / ${dry.team_elec} / ${dry.team_null}`, "637 / 1,061 / 0"],
                    ["신규 A compliance (전체/linked)", `${dry.new_a} / ${dry.new_a_linked}`, "260 / 236"],
                    ["attachment linked / needs_review", `${dry.att_linked} / ${dry.att_needs_review}`, "2,262 / 48"],
                    ["Storage missing / orphan", `${dry.storage_missing} / ${dry.storage_orphan}`, "0 / 0"],
                  ] as [string, string | number, string | number][]
                ).map(([k, v, base]) => (
                  <TableRow key={k}>
                    <TableCell>{k}</TableCell>
                    <TableCell className="text-right font-mono">{v}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{base}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {blockers.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> 차단 조건
                </div>
                <ul className="list-inside list-disc">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <CheckCircle2 className="h-4 w-4" /> 차단 조건 없음 — 승인 후 Import 가능
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={approved} onCheckedChange={(v) => setApproved(v === true)} disabled={blockers.length > 0} />
              Stage B Import 승인 (위 수치를 확인했습니다)
            </label>

            <Button onClick={onImport} disabled={!canImport}>
              {busy && !busy.startsWith("사전") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              5. Stage B Import 실행
            </Button>
          </div>
        )}

        {failedBatches.length > 0 && (
          <div className="rounded-md border border-destructive/40 p-3 text-xs">
            {failedBatches.map((f) => (
              <div key={f}>{f}</div>
            ))}
            <div className="mt-1 text-muted-foreground">동일 파일을 다시 선택해 재실행하면 복구됩니다.</div>
          </div>
        )}

        {result && (
          <pre className="max-h-72 overflow-auto rounded-md border p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
