import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FilePickerButton } from "@/components/shared/FilePickerButton";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { chunk, sha256Hex } from "@/lib/abd/ocs-db-parser";
import {
  crossValidate,
  parseV3Atomic,
  parseV3Delta,
  parseV3Policy,
  parseV3ResponseMapping,
  type V3AtomicParse,
  type V3DeltaParse,
  type V3PolicyParse,
  type V3ResponseParse,
} from "@/lib/abd/ocs-v3-parser";
import {
  ocsV3DryRun,
  ocsV3Import,
  ocsV3StageLoad,
  ocsV3StageReset,
  type V3StageKind,
} from "@/lib/abd/ocs-v3-import.functions";
import { createPreImportSnapshot, getLatestPreImportSnapshot } from "@/lib/backup/backup.functions";

const BATCH = 500;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

type Dry = Record<string, unknown>;
type FileMeta = { name: string; hash: string; rows: number };
type Kind = "atomic" | "delta" | "resp" | "policy";

/** 지시문 기대값 18항목 */
type Expect = { no: number; label: string; expect: number; key: string; strict?: boolean };
const EXPECTS: Expect[] = [
  { no: 1, label: "physical atomic", expect: 7240, key: "physical_atomic", strict: true },
  { no: 2, label: "inactive blank", expect: 3, key: "inactive_blank", strict: true },
  { no: 3, label: "active atomic", expect: 7237, key: "active_atomic", strict: true },
  { no: 4, label: "linked", expect: 7236, key: "linked" },
  { no: 5, label: "linked_multi", expect: 1, key: "linked_multi" },
  { no: 6, label: "active unmatched", expect: 0, key: "active_unmatched", strict: true },
  { no: 7, label: "distinct ABD (해소)", expect: 1066, key: "distinct_abd_resolved", strict: true },
  { no: 8, label: "ABD link associations", expect: 7241, key: "abd_link_associations", strict: true },
  { no: 9, label: "missing parent", expect: 0, key: "missing_parent", strict: true },
  { no: 10, label: "duplicate active atomic ID", expect: 0, key: "duplicate_active_atomic_id", strict: true },
  { no: 11, label: "unresolved attachment", expect: 0, key: "unresolved_attachments", strict: true },
  { no: 12, label: "duplicate attachment/comment pair", expect: 0, key: "duplicate_attachment_comment_pairs", strict: true },
  { no: 13, label: "group-inherited attachments", expect: 740, key: "attachments_group_only", strict: true },
  { no: 14, label: "Open Response segments", expect: 520, key: "open_response_segments", strict: true },
  { no: 15, label: "group responses (Open)", expect: 136, key: "open_response_groups", strict: true },
  { no: 16, label: "remaining decision required", expect: 0, key: "remaining_decision_required", strict: true },
  { no: 17, label: "사용자 Compliance 충돌", expect: 0, key: "user_compliance_conflicts", strict: true },
  { no: 18, label: "Raw Data OCS after 값", expect: 18, key: "raw_data_ocs_corrections_after", strict: true },
];

function Row({ label, value, bad }: { label: string; value: unknown; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${bad ? "font-semibold text-destructive" : ""}`}>
        {String(value)}
      </span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 text-xs font-semibold">{title}</div>
      {children}
    </div>
  );
}

function dryValue(dry: Dry, key: string): number {
  if (key in dry) return num(dry[key]);
  const metrics = dry["attachment_metrics"] as Record<string, unknown> | undefined;
  if (metrics && key in metrics) return num(metrics[key]);
  return 0;
}

export function OcsAtomicV3Panel() {
  const stageReset = useServerFn(ocsV3StageReset);
  const stageLoad = useServerFn(ocsV3StageLoad);
  const dryRunFn = useServerFn(ocsV3DryRun);
  const importFn = useServerFn(ocsV3Import);
  const snapshotFn = useServerFn(createPreImportSnapshot);
  const latestSnapshotFn = useServerFn(getLatestPreImportSnapshot);

  const [atomic, setAtomic] = useState<V3AtomicParse | null>(null);
  const [atomicFile, setAtomicFile] = useState<FileMeta | null>(null);
  const [delta, setDelta] = useState<V3DeltaParse | null>(null);
  const [deltaFile, setDeltaFile] = useState<FileMeta | null>(null);
  const [resp, setResp] = useState<V3ResponseParse | null>(null);
  const [respFile, setRespFile] = useState<FileMeta | null>(null);
  const [policy, setPolicy] = useState<V3PolicyParse | null>(null);
  const [policyFile, setPolicyFile] = useState<FileMeta | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [dry, setDry] = useState<Dry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [snapshotInfo, setSnapshotInfo] = useState<{ name: string; created_at: string } | null>(null);
  const [dryAt, setDryAt] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = (await latestSnapshotFn({ data: { module: "abd" } })) as {
          id: string;
          name: string;
          created_at: string;
        } | null;
        if (!alive || !s) return;
        setSnapshotInfo({ name: s.name, created_at: s.created_at });
      } catch {
        /* 조회 실패는 무시 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [latestSnapshotFn]);

  const cross = useMemo(
    () =>
      crossValidate({
        atomic,
        atomicHash: atomicFile?.hash ?? null,
        delta,
        resp,
        respHash: respFile?.hash ?? null,
        policy,
      }),
    [atomic, atomicFile, delta, resp, respFile, policy],
  );

  const expectRows = useMemo(() => {
    if (!dry) return [];
    return EXPECTS.map((e) => {
      const actual = dryValue(dry, e.key);
      return { ...e, actual, ok: actual === e.expect };
    });
  }, [dry]);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!atomic) out.push("Atomic V3 파일이 필요합니다.");
    if (!delta) out.push("Delta Audit 파일이 필요합니다.");
    if (!resp) out.push("Contractor Response Mapping 파일이 필요합니다.");
    if (!policy) out.push("Final Import Policy 파일이 필요합니다.");
    if (atomic) {
      if (atomic.comments.length !== 7240)
        out.push(`V3 atomic rows ${atomic.comments.length} ≠ 7,240`);
      if (atomic.source_parent_count !== 1955)
        out.push(`source parents ${atomic.source_parent_count} ≠ 1,955`);
      if (atomic.duplicated_atomic_ids.length > 0)
        out.push(`duplicate atomic ID ${atomic.duplicated_atomic_ids.length}건`);
      if (atomic.residual_multi_marker_rows > 0)
        out.push(`잔존 복수 번호 행 ${atomic.residual_multi_marker_rows}건`);
      if (atomic.invalid_rows.length > 0) out.push(`형식 오류 ${atomic.invalid_rows.length}건`);
    }
    if (delta && delta.changed_parents !== 138)
      out.push(`changed parents ${delta.changed_parents} ≠ 138`);
    if (resp && resp.duplicate_links > 0) out.push(`response 중복 링크 ${resp.duplicate_links}건`);
    for (const i of cross.issues) out.push(i);
    if (dry) {
      for (const r of expectRows) {
        if (!r.ok && r.strict) out.push(`기대값 #${r.no} ${r.label} ${r.actual} ≠ ${r.expect}`);
      }
    } else {
      out.push("최종 Dry-run 미실행");
    }
    if (!snapshotId) out.push("사전 백업 스냅샷 미완료 (dry-run 이후 생성분만 인정)");
    return out;
  }, [atomic, delta, resp, policy, cross, dry, expectRows, snapshotId]);

  function resetDownstream() {
    setDry(null);
    setRunId(null);
    setSnapshotId(null);
    setDryAt(null);
    setImportResult(null);
  }

  async function readFile(files: FileList, kind: Kind) {
    const file = files[0];
    if (!file) return;
    setBusy("파일 읽는 중…");
    try {
      const text = await file.text();
      const hash = await sha256Hex(text);
      const json = JSON.parse(text) as unknown;
      if (kind === "atomic") {
        const p = parseV3Atomic(json);
        if (p.comments.length === 0) throw new Error("V3 atomic 행을 찾지 못했습니다.");
        setAtomic(p);
        setAtomicFile({ name: file.name, hash, rows: p.comments.length });
      } else if (kind === "delta") {
        const p = parseV3Delta(json);
        setDelta(p);
        setDeltaFile({ name: file.name, hash, rows: p.changed_parent_ids.length });
      } else if (kind === "resp") {
        const p = parseV3ResponseMapping(json);
        setResp(p);
        setRespFile({ name: file.name, hash, rows: p.segments.length });
      } else {
        const p = parseV3Policy(json);
        if (!p.policy_version) throw new Error("policy_version 이 없습니다.");
        setPolicy(p);
        setPolicyFile({ name: file.name, hash, rows: p.group_response_decisions });
      }
      resetDownstream();
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
    if (!atomic || !resp || !policy) return;
    setBusy("최종 Dry-run 실행 중…");
    setProgress(0);
    try {
      const run = crypto.randomUUID();
      await stageReset({ data: { run_id: run } });
      await stage(run, "groups", atomic.groups, 0, 8);
      await stage(run, "comments", atomic.comments, 8, 55);
      await stage(run, "attachments", atomic.attachments, 63, 22);
      await stage(run, "response", resp.segments, 85, 10);
      const out = (await dryRunFn({ data: { run_id: run } })) as Dry;
      setRunId(run);
      setDry(out);
      setDryAt(Date.now());
      setSnapshotId(null);
      setProgress(100);
      toast.success("최종 Dry-run 완료 (운영 데이터 변경 없음)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  async function runSnapshot() {
    if (busy || !dryAt) return;
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

  async function runImport() {
    if (!runId || !snapshotId || blockers.length > 0) return;
    setBusy("V3 Import 실행 중…");
    try {
      const out = (await importFn({
        data: { run_id: runId, snapshot_id: snapshotId },
      })) as Record<string, unknown>;
      setImportResult(out);
      toast.success("V3 Import 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" /> Atomic V3 One-Time Correction
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          One-time correction of the initially migrated OCS data.
          <br />
          This is not the recurring OCS Excel import workflow.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs font-medium">1. OCS_Atomic_V3_Corrected_DB.json</div>
            <FilePickerButton
              label="Atomic V3 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readFile(f, "atomic")}
            />
            {atomic && atomicFile && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  atomic {atomicFile.rows}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  groups {atomic.groups.length}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  parents {atomic.source_parent_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  active {atomic.active_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  attachments {atomic.attachments.length}
                </Badge>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium">2. OCS_Atomic_V2_to_V3_Delta_Audit.json</div>
            <FilePickerButton
              label="Delta Audit 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readFile(f, "delta")}
            />
            {delta && deltaFile && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  changed {delta.changed_parents}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  unchanged {delta.unchanged_parents}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  V2 {delta.v2_atomic} → V3 {delta.v3_atomic}
                </Badge>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium">
              3. OCS_Contractor_Response_Atomic_Mapping_V3.json
            </div>
            <FilePickerButton
              label="Response Mapping 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readFile(f, "resp")}
            />
            {resp && respFile && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  segments {respFile.rows}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  confirmed {resp.confirmed_high}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  open {resp.open_segments}/{resp.open_groups}그룹
                </Badge>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium">4. OCS_V3_Final_Import_Policy.json</div>
            <FilePickerButton
              label="Import Policy 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readFile(f, "policy")}
            />
            {policy && policyFile && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  {policy.policy_version}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  open {policy.open_segment_count}/{policy.open_group_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  images {policy.group_inherited_attachment_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  raw OCS {policy.raw_data_ocs_change_count}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {policy && (atomicFile || respFile) && (
          <Block title="SHA-256 관문">
            <Row
              label="Atomic V3"
              value={
                atomicFile
                  ? policy.atomic_v3_sha256 === atomicFile.hash
                    ? `일치 ${atomicFile.hash.slice(0, 16)}…`
                    : `불일치 ${atomicFile.hash.slice(0, 16)}…`
                  : "미선택"
              }
              bad={!!atomicFile && policy.atomic_v3_sha256 !== atomicFile.hash}
            />
            <Row
              label="Response Mapping"
              value={
                respFile
                  ? policy.response_mapping_sha256 === respFile.hash
                    ? `일치 ${respFile.hash.slice(0, 16)}…`
                    : `불일치 ${respFile.hash.slice(0, 16)}…`
                  : "미선택"
              }
              bad={!!respFile && policy.response_mapping_sha256 !== respFile.hash}
            />
            <Row label="group response decisions" value={policy.group_response_decisions} />
          </Block>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !atomic || !resp || !policy}
            onClick={() => void runDryRun()}
          >
            {busy === "최종 Dry-run 실행 중…" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            5. 최종 Dry-run (운영 변경 없음)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !dryAt}
            onClick={() => void runSnapshot()}
          >
            {busy === "사전 백업 스냅샷 생성 중…" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            6. 사전 백업 스냅샷
          </Button>
          {snapshotId && (
            <Badge variant="secondary" className="text-[11px]">
              스냅샷 {snapshotId.slice(0, 8)}
            </Badge>
          )}
          {!snapshotId && snapshotInfo && (
            <Badge variant="outline" className="text-[11px]">
              직전 스냅샷 {snapshotInfo.name} (V3 관문 아님)
            </Badge>
          )}
          <Button
            size="sm"
            disabled={!!busy || blockers.length > 0 || !runId || !snapshotId}
            title={
              blockers.length > 0
                ? `차단 ${blockers.length}건: ${blockers[0]}`
                : "V3 본체 Import 실행"
            }
            onClick={() => void runImport()}
          >
            {busy === "V3 Import 실행 중…" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            7. V3 Import 실행
          </Button>
        </div>
        {busy && progress > 0 && <Progress value={progress} />}

        {blockers.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" /> Import 차단 조건 {blockers.length}건
            </div>
            <ul className="list-inside list-disc space-y-0.5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {dry && (
          <Block title="최종 Dry-run — 기대값 18항목">
            <div className="grid gap-x-6 md:grid-cols-2">
              {expectRows.map((r) => (
                <div
                  key={r.no}
                  className="flex items-center justify-between gap-3 border-b py-1 text-xs"
                >
                  <span className="text-muted-foreground">
                    #{r.no} {r.label}
                  </span>
                  <span
                    className={`font-mono ${r.ok ? "" : "font-semibold text-destructive"}`}
                  >
                    {r.actual} / {r.expect}
                    {r.ok ? " ✓" : " ✗"}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        )}

        {dry && (
          <div className="grid gap-3 md:grid-cols-2">
            <Block title="Comments 반영 계획">
              <Row label="insert 예정" value={dryValue(dry, "comments_to_insert")} />
              <Row label="update 예정" value={dryValue(dry, "comments_to_update")} />
              <Row label="V2 부모 supersede 예정" value={dryValue(dry, "v2_parents_to_supersede")} />
              <Row label="V2 active 잔여(무관)" value={dryValue(dry, "v2_active_orphans")} />
              <Row label="ABD 미해소 번호" value={dryValue(dry, "abd_numbers_unresolved")} bad={dryValue(dry, "abd_numbers_unresolved") > 0} />
            </Block>
            <Block title="Attachments / Response / Compliance">
              <Row label="staged attachments" value={dryValue(dry, "staged_attachments")} />
              <Row label="scope single / group / review"
                value={`${dryValue(dry, "attachment_scope_single")} / ${dryValue(dry, "attachment_scope_group")} / ${dryValue(dry, "attachment_scope_needs_review")}`}
              />
              <Row label="confirmed_high segments" value={dryValue(dry, "confirmed_high_segments")} />
              <Row label="사용자 Compliance 행" value={dryValue(dry, "user_compliance_rows")} />
              <Row label="승계 예정(true)" value={dryValue(dry, "user_compliance_true_to_carry")} />
              <Row label="Raw Data OCS 교정 총건" value={dryValue(dry, "raw_data_ocs_corrections_total")} />
            </Block>
          </div>
        )}

        {importResult && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" /> V3 Import 완료
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
              {JSON.stringify(importResult, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
