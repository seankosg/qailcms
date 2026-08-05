import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FilePickerButton } from "@/components/shared/FilePickerButton";
import { AlertTriangle, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { chunk, sha256Hex } from "@/lib/abd/ocs-db-parser";
import {
  crossCheckResponse,
  foldParents,
  parseV3Atomic,
  parseV3Delta,
  parseV3ResponseMapping,
  type V3AtomicParse,
  type V3DeltaParse,
  type V3ResponseParse,
} from "@/lib/abd/ocs-v3-parser";
import { ocsV3DryRunParents } from "@/lib/abd/ocs-v3-import.functions";
import { createPreImportSnapshot, getLatestPreImportSnapshot } from "@/lib/backup/backup.functions";

const BATCH = 100;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

const ARRAY_KEYS = [
  "parent_ids",
  "missing_parent_ids",
  "conflict_ids",
  "superseded_ids",
  "blocked_ids",
  "abd_item_ids",
  "changed_parent_ids",
] as const;

type Agg = Record<string, number>;
type FileMeta = { name: string; hash: string; rows: number };

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

export function OcsAtomicV3Panel() {
  const dryRun = useServerFn(ocsV3DryRunParents);
  const snapshotFn = useServerFn(createPreImportSnapshot);
  const latestSnapshotFn = useServerFn(getLatestPreImportSnapshot);

  const [atomic, setAtomic] = useState<V3AtomicParse | null>(null);
  const [atomicFile, setAtomicFile] = useState<FileMeta | null>(null);
  const [delta, setDelta] = useState<V3DeltaParse | null>(null);
  const [deltaFile, setDeltaFile] = useState<FileMeta | null>(null);
  const [resp, setResp] = useState<V3ResponseParse | null>(null);
  const [respFile, setRespFile] = useState<FileMeta | null>(null);

  const [dry, setDry] = useState<Agg | null>(null);
  const [distinct, setDistinct] = useState<Agg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [snapshotInfo, setSnapshotInfo] = useState<{ name: string; created_at: string } | null>(
    null,
  );
  const [dryAt, setDryAt] = useState<number | null>(null);

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
    () => (atomic && resp ? crossCheckResponse(atomic, resp) : null),
    [atomic, resp],
  );

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!atomic) out.push("Atomic V3 파일이 필요합니다.");
    if (!delta) out.push("Delta Audit 파일이 필요합니다.");
    if (!resp) out.push("Contractor Response Mapping 파일이 필요합니다.");
    if (atomic) {
      if (atomic.rows.length !== 7240) out.push(`V3 atomic rows ${atomic.rows.length} ≠ 7,240`);
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
    if (cross && cross.confirmed_high_unresolved > 0)
      out.push(`confirmed_high 대상 코멘트 누락 ${cross.confirmed_high_unresolved}건`);
    if (resp && resp.duplicate_links > 0) out.push(`response 중복 링크 ${resp.duplicate_links}건`);
    if (dry) {
      if (num(dry["missing_parent"]) > 0)
        out.push(`부모 그룹 미존재 ${num(dry["missing_parent"])}건`);
      if (num(dry["compliance_blocked_user_true"]) > 0)
        out.push(
          `사용자 직접 complied=true 의미 충돌 ${num(dry["compliance_blocked_user_true"])}건`,
        );
      if (distinct && num(distinct["changed_parents"]) !== 138)
        out.push(`dry-run 변경 부모 ${num(distinct["changed_parents"])} ≠ 138`);
    } else {
      out.push("Dry-run 미실행");
    }
    if (!snapshotId) out.push("사전 백업 미완료 (dry-run 이후 생성분만 인정)");
    return out;
  }, [atomic, delta, resp, cross, dry, distinct, snapshotId]);

  async function readFile(files: FileList, kind: "atomic" | "delta" | "resp") {
    const f = files[0];
    if (!f) return;
    setBusy("파일 읽는 중…");
    try {
      const text = await f.text();
      const hash = await sha256Hex(text);
      const json = JSON.parse(text) as unknown;
      if (kind === "atomic") {
        const p = parseV3Atomic(json);
        if (p.rows.length === 0) throw new Error("V3 atomic 행을 찾지 못했습니다.");
        setAtomic(p);
        setAtomicFile({ name: f.name, hash, rows: p.rows.length });
      } else if (kind === "delta") {
        const p = parseV3Delta(json);
        setDelta(p);
        setDeltaFile({ name: f.name, hash, rows: p.changed_parent_ids.length });
      } else {
        const p = parseV3ResponseMapping(json);
        setResp(p);
        setRespFile({ name: f.name, hash, rows: p.segments.length });
      }
      setDry(null);
      setDistinct(null);
      setSnapshotId(null);
      setDryAt(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runDryRun() {
    if (!atomic) return;
    setBusy("Dry-run 실행 중…");
    setProgress(0);
    try {
      const parents = foldParents(atomic.rows);
      const batches = chunk(parents, BATCH);
      let agg: Agg = {};
      const sets: Record<string, Set<string>> = {};
      for (let i = 0; i < batches.length; i += 1) {
        const res = (await dryRun({ data: { rows: batches[i] as unknown[] } })) as Record<
          string,
          unknown
        >;
        for (const [k, v] of Object.entries(res)) {
          if (Array.isArray(v)) {
            const set = sets[k] ?? (sets[k] = new Set<string>());
            for (const x of v) if (x != null) set.add(String(x));
          } else {
            agg[k] = (agg[k] ?? 0) + num(v);
          }
        }
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }
      agg = { ...agg };
      setDry(agg);
      setDistinct({
        parents: sets["parent_ids"]?.size ?? 0,
        changed_parents: sets["changed_parent_ids"]?.size ?? 0,
        missing_parents: sets["missing_parent_ids"]?.size ?? 0,
        conflicts: sets["conflict_ids"]?.size ?? 0,
        superseded: sets["superseded_ids"]?.size ?? 0,
        blocked_user_true: sets["blocked_ids"]?.size ?? 0,
        distinct_abd_items: sets["abd_item_ids"]?.size ?? 0,
      });
      setDryAt(Date.now());
      setSnapshotId(null);
      toast.success("Dry-run 완료 (DB 변경 없음)");
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
      setSnapshotId(res?.id ?? null);
      toast.success("사전 백업 스냅샷 생성 완료");
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
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs font-medium">1. OCS_Atomic_V3_DryRun.json</div>
            <FilePickerButton
              label="Atomic V3 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readFile(f, "atomic")}
            />
            {atomic && atomicFile && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  행 {atomicFile.rows}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  parents {atomic.source_parent_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  multi {atomic.multi_group_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  single {atomic.single_comment_count}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  attachments {atomic.attachments_metadata}
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
            {delta && (
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
                  probable {resp.probable}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  review {resp.requires_review}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  dup {resp.duplicate_ignored}
                </Badge>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !atomic}
            onClick={() => void runDryRun()}
          >
            {busy === "Dry-run 실행 중…" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            4. Dry-run (DB 변경 없음)
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
            5. 사전 백업 스냅샷
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
          <Button size="sm" disabled title="사용자 승인 후 별도 단계에서 활성화됩니다.">
            6. V3 Import (승인 전 비활성)
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

        {dry && distinct && (
          <div className="grid gap-3 md:grid-cols-2">
            <Block title="9.1 Comments">
              <Row label="V2 active" value={num(dry["v2_active"])} />
              <Row label="V3 target active" value={atomic?.rows.length ?? 0} />
              <Row label="unchanged" value={num(dry["unchanged"])} />
              <Row label="updated" value={num(dry["updated"])} />
              <Row label="inserted" value={num(dry["inserted"])} />
              <Row label="superseded" value={num(dry["superseded"])} />
              <Row label="changed source parents" value={distinct["changed_parents"] ?? 0} />
              <Row
                label="ID/content conflicts"
                value={distinct["conflicts"] ?? 0}
                bad={(distinct["conflicts"] ?? 0) > 0}
              />
              <Row
                label="duplicate IDs"
                value={atomic?.duplicated_atomic_ids.length ?? 0}
                bad={(atomic?.duplicated_atomic_ids.length ?? 0) > 0}
              />
              <Row
                label="missing parents"
                value={distinct["missing_parents"] ?? 0}
                bad={(distinct["missing_parents"] ?? 0) > 0}
              />
              <Row label="linked" value={num(dry["linked_children"])} />
              <Row label="unmatched" value={num(dry["unmatched_children"])} />
              <Row label="distinct ABD items" value={distinct["distinct_abd_items"] ?? 0} />
            </Block>

            <Block title="9.2 Compliance">
              <Row label="preserved" value={num(dry["compliance_preserved"])} />
              <Row
                label="blocked user-true conflicts"
                value={num(dry["compliance_blocked_user_true"])}
                bad={num(dry["compliance_blocked_user_true"]) > 0}
              />
              <Row label="user-false rows" value={num(dry["compliance_user_false"])} />
              <Row
                label="import-status-A preserved"
                value={num(dry["compliance_import_a_preserved"])}
              />
              <Row
                label="import-status-A at risk"
                value={num(dry["compliance_import_a_at_risk"])}
                bad={num(dry["compliance_import_a_at_risk"]) > 0}
              />
              <Row label="compliance log preserved" value={num(dry["compliance_log_rows"])} />
            </Block>

            <Block title="9.3 Contractor Response">
              <Row label="total segments" value={resp?.segments.length ?? 0} />
              <Row label="confirmed high" value={resp?.confirmed_high ?? 0} />
              <Row label="probable" value={resp?.probable ?? 0} />
              <Row label="requires review" value={resp?.requires_review ?? 0} />
              <Row label="duplicate ignored" value={resp?.duplicate_ignored ?? 0} />
              <Row label="resolved target IDs" value={cross?.confirmed_high_resolved ?? 0} />
              <Row
                label="unresolved target IDs"
                value={cross?.confirmed_high_unresolved ?? 0}
                bad={(cross?.confirmed_high_unresolved ?? 0) > 0}
              />
              <Row
                label="confirmed-high unique comments"
                value={cross?.confirmed_high_unique_targets ?? 0}
              />
              <Row label="reviewed source groups" value={cross?.reviewed_source_groups ?? 0} />
              <Row
                label="atomic comments in groups"
                value={cross?.atomic_comments_in_groups ?? 0}
              />
              <Row
                label="duplicate links"
                value={resp?.duplicate_links ?? 0}
                bad={(resp?.duplicate_links ?? 0) > 0}
              />
            </Block>

            <Block title="9.4 Attachments">
              <Row label="preserved confirmed links" value={num(dry["att_confirmed_preserved"])} />
              <Row label="downgraded-to-group links" value={num(dry["att_confirmed_downgraded"])} />
              <Row label="group attachments touched" value={num(dry["att_group_attachments"])} />
              <Row label="V3 attachments metadata" value={atomic?.attachments_metadata ?? 0} />
              <p className="pt-1 text-[11px] text-muted-foreground">
                Storage 파일은 이동·삭제·복제하지 않습니다. 의미가 바뀐 child 의 confirmed 링크는
                group-level access 로 낮춥니다.
              </p>
            </Block>

            <Block title="9.5 Cache 예상값">
              <Row label="예상 sum(ocs_total)" value={num(dry["linked_children"])} />
              <Row label="예상 sum(ocs_complied)" value={num(dry["expected_complied"])} />
              <Row label="영향 ABD 행(distinct)" value={distinct["distinct_abd_items"] ?? 0} />
            </Block>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
