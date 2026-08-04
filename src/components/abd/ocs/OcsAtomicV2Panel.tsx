import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { FilePickerButton } from "@/components/shared/FilePickerButton";
import { AlertTriangle, CheckCircle2, DatabaseZap, Loader2, ShieldCheck } from "lucide-react";
import { chunk, sha256Hex } from "@/lib/abd/ocs-db-parser";
import {
  attachV2RowHashes,
  parseOcsV2CommentJson,
  parseOcsV2LinkJson,
  type OcsV2CommentParse,
  type OcsV2CommentRow,
  type OcsV2LinkParse,
} from "@/lib/abd/ocs-v2-parser";
import {
  ocsV2DryRunAttachments,
  ocsV2DryRunComments,
  ocsV2FinalizeParents,
  ocsV2ImportComments,
  ocsV2ImportGroups,
  ocsV2ImportLinks,
  ocsV2Verify,
  ocsRecountAll,
} from "@/lib/abd/ocs-v2-import.functions";
import { createOcsImportLog, updateOcsImportLog } from "@/lib/abd/ocs-stage-b.functions";
import { createPreImportSnapshot } from "@/lib/backup/backup.functions";

const BATCH = 200;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

type DryAgg = Record<string, number>;

const ARRAY_KEYS = new Set([
  "parent_ids",
  "group_keys",
  "abd_item_ids",
  "split_user_check_pids",
  "user_row_pids",
  "missing_parent_ids",
  "resolved_ids",
  "unresolved_ids",
]);

function addAgg(a: DryAgg, b: Record<string, unknown>): DryAgg {
  const out: DryAgg = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (ARRAY_KEYS.has(k) || Array.isArray(v)) continue; // 고유값은 합산 금지 — Set union 으로 처리
    out[k] = (out[k] ?? 0) + num(v);
  }
  return out;
}

/** 배치 응답의 ID 배열을 전역 Set 에 합친다. */
function unionInto(sets: Record<string, Set<string>>, b: Record<string, unknown>) {
  for (const k of ARRAY_KEYS) {
    const v = b[k];
    if (!Array.isArray(v)) continue;
    const set = sets[k] ?? (sets[k] = new Set<string>());
    for (const x of v) if (x !== null && x !== undefined) set.add(String(x));
  }
}

export function OcsAtomicV2Panel() {
  const dryComments = useServerFn(ocsV2DryRunComments);
  const dryAtts = useServerFn(ocsV2DryRunAttachments);
  const createLog = useServerFn(createOcsImportLog);
  const patchLog = useServerFn(updateOcsImportLog);
  const impGroups = useServerFn(ocsV2ImportGroups);
  const impComments = useServerFn(ocsV2ImportComments);
  const impLinks = useServerFn(ocsV2ImportLinks);
  const finalize = useServerFn(ocsV2FinalizeParents);
  const verify = useServerFn(ocsV2Verify);
  const recount = useServerFn(ocsRecountAll);
  const snapshotFn = useServerFn(createPreImportSnapshot);

  const [atomicFile, setAtomicFile] = useState<{ name: string; hash: string } | null>(null);
  const [linkFile, setLinkFile] = useState<{ name: string; hash: string } | null>(null);
  const [parsed, setParsed] = useState<OcsV2CommentParse | null>(null);
  const [rows, setRows] = useState<OcsV2CommentRow[]>([]);
  const [links, setLinks] = useState<OcsV2LinkParse | null>(null);
  const [dry, setDry] = useState<DryAgg | null>(null);
  const [dryAtt, setDryAtt] = useState<DryAgg | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [verifyOut, setVerifyOut] = useState<Record<string, unknown> | null>(null);

  const unresolvedLinkComments = useMemo(() => {
    if (!links || rows.length === 0) return 0;
    const known = new Set(rows.map((r) => r.source_comment_id));
    return links.rows.filter((l) => !known.has(l.source_comment_id)).length;
  }, [links, rows]);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!parsed || rows.length === 0) out.push("원자화 코멘트 파일이 필요합니다.");
    if (parsed && parsed.duplicated_comment_ids.length > 0)
      out.push(`Atomic Comment ID 중복 ${parsed.duplicated_comment_ids.length}건`);
    if (parsed && parsed.invalid_rows.length > 0) out.push(`형식 오류 ${parsed.invalid_rows.length}건`);
    if (dry && num(dry["parent_missing"]) > 0)
      out.push(`부모 코멘트 미존재 ${num(dry["parent_missing"])}건`);
    if (dry && num(dry["parents_split_with_user_check"]) > 0)
      out.push(`사용자 Complied 체크가 있는 분할 대상 ${num(dry["parents_split_with_user_check"])}건`);
    if (unresolvedLinkComments > 0)
      out.push(`링크 파일의 미확인 Comment ID ${unresolvedLinkComments}건`);
    if (dryAtt && num(dryAtt["unresolved"]) > 0)
      out.push(`링크 파일의 미확인 Attachment ID ${num(dryAtt["unresolved"])}건`);
    return out;
  }, [parsed, rows, dry, dryAtt, unresolvedLinkComments]);

  async function readJson(files: FileList, kind: "atomic" | "link") {
    const f = files[0];
    if (!f) return;
    setBusy("파일 읽는 중…");
    try {
      const text = await f.text();
      const hash = await sha256Hex(text);
      const json = JSON.parse(text) as unknown;
      if (kind === "atomic") {
        const p = parseOcsV2CommentJson(json);
        if (p.rows.length === 0) throw new Error("원자화 코멘트 행을 찾지 못했습니다.");
        setParsed(p);
        setRows(await attachV2RowHashes(p.rows));
        setAtomicFile({ name: f.name, hash });
      } else {
        const p = parseOcsV2LinkJson(json);
        setLinks(p);
        setLinkFile({ name: f.name, hash });
      }
      setDry(null);
      setDryAtt(null);
      setApproved(false);
      setResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runDryRun() {
    if (rows.length === 0) return;
    setBusy("Dry-run 실행 중…");
    setProgress(0);
    try {
      let agg: DryAgg = {};
      const batches = chunk(rows, BATCH);
      for (let i = 0; i < batches.length; i += 1) {
        const res = (await dryComments({ data: { rows: batches[i] as unknown[] } })) as Record<
          string,
          unknown
        >;
        agg = addAgg(agg, res);
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }
      setDry(agg);

      if (links && links.rows.length > 0) {
        let aggA: DryAgg = {};
        const ids = Array.from(new Set(links.rows.map((l) => l.source_attachment_id)));
        for (const b of chunk(ids, BATCH)) {
          const res = (await dryAtts({ data: { ids: b } })) as Record<string, unknown>;
          aggA = addAgg(aggA, res);
        }
        setDryAtt(aggA);
      }
      toast.success("Dry-run 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  async function runSnapshot() {
    setBusy("사전 백업 스냅샷 생성 중…");
    try {
      const res = (await snapshotFn({ data: { module: "abd" } })) as { id?: string } | null;
      const id = res?.id ?? null;
      setSnapshotId(id);
      toast.success("사전 백업 스냅샷 생성 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!parsed || rows.length === 0 || blockers.length > 0 || !approved || !snapshotId) return;
    setBusy("Import 실행 중…");
    setProgress(0);
    try {
      const log = (await createLog({
        data: {
          data_file_name: atomicFile?.name ?? "OCS_Atomic_V2.json",
          data_file_hash: atomicFile?.hash ?? "",
          manifest_name: linkFile?.name ?? "",
          manifest_hash: linkFile?.hash ?? "",
          total_count: rows.length,
          attachment_total: links?.rows.length ?? 0,
          snapshot_id: snapshotId,
          dryrun: { ...(dry ?? {}), attachments: dryAtt ?? {} },
        },
      })) as { id: string };

      const groupTotals = { inserted: 0, updated: 0 };
      for (const b of chunk(parsed.groups, BATCH)) {
        const r = (await impGroups({
          data: { import_log_id: log.id, rows: b as unknown[] },
        })) as Record<string, unknown>;
        groupTotals.inserted += num(r["inserted"]);
        groupTotals.updated += num(r["updated"]);
      }

      const cmtTotals = { inserted: 0, updated: 0, skipped_missing_parent: 0 };
      const cBatches = chunk(rows, BATCH);
      for (let i = 0; i < cBatches.length; i += 1) {
        const r = (await impComments({
          data: { import_log_id: log.id, rows: cBatches[i] as unknown[] },
        })) as Record<string, unknown>;
        cmtTotals.inserted += num(r["inserted"]);
        cmtTotals.updated += num(r["updated"]);
        cmtTotals.skipped_missing_parent += num(r["skipped_missing_parent"]);
        setProgress(Math.round(((i + 1) / cBatches.length) * 80));
      }

      const linkTotals = { inserted: 0, updated: 0, unresolved: 0 };
      if (links) {
        for (const b of chunk(links.rows, BATCH)) {
          const r = (await impLinks({
            data: { import_log_id: log.id, rows: b as unknown[] },
          })) as Record<string, unknown>;
          linkTotals.inserted += num(r["inserted"]);
          linkTotals.updated += num(r["updated"]);
          linkTotals.unresolved += num(r["unresolved"]);
        }
      }
      setProgress(90);

      const fin = (await finalize({ data: { import_log_id: log.id } })) as Record<string, unknown>;
      await recount({});
      setProgress(100);

      await patchLog({
        data: {
          id: log.id,
          patch: {
            status: "completed",
            result: { groups: groupTotals, comments: cmtTotals, links: linkTotals, finalize: fin },
          },
        },
      });

      setResult({ groups: groupTotals, comments: cmtTotals, links: linkTotals, finalize: fin });
      setVerifyOut((await verify({})) as Record<string, unknown>);
      toast.success("Atomic V2 Import 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const kv = (o: Record<string, unknown> | null) =>
    o
      ? Object.entries(o).map(([k, v]) => (
          <Badge key={k} variant="outline" className="text-[11px]">
            {k} {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </Badge>
        ))
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseZap className="h-4 w-4" /> Atomic Comment V2 교정 이관
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs font-medium">1. 원자화 코멘트 JSON</div>
            <FilePickerButton
              label="OCS_Atomic_V2 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readJson(f, "atomic")}
            />
            {parsed && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  행 {parsed.rows.length}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  그룹 {parsed.groups.length}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  단일 {parsed.single_rows}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  분할 {parsed.split_rows}
                </Badge>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium">2. 첨부↔코멘트 링크 JSON</div>
            <FilePickerButton
              label="UI_Access_Links 선택"
              accept=".json,application/json"
              disabled={!!busy}
              onFiles={(f) => void readJson(f, "link")}
            />
            {links && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  링크 {links.rows.length}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  이미지 {links.distinct_attachments}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  코멘트 {links.distinct_comments}
                </Badge>
                {links.duplicated_pairs > 0 && (
                  <Badge variant="outline" className="text-[11px]">
                    중복쌍 제거 {links.duplicated_pairs}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!busy || rows.length === 0} onClick={() => void runDryRun()}>
            {busy === "Dry-run 실행 중…" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            3. Dry-run (DB 변경 없음)
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !dry} onClick={() => void runSnapshot()}>
            <ShieldCheck className="mr-2 h-4 w-4" /> 4. 사전 백업 스냅샷
          </Button>
          {snapshotId && (
            <Badge variant="secondary" className="text-[11px]">
              스냅샷 {snapshotId.slice(0, 8)}
            </Badge>
          )}
        </div>
        {busy && progress > 0 && <Progress value={progress} />}

        {dry && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">Dry-run 결과</div>
            <div className="flex flex-wrap gap-1.5">{kv(dry)}</div>
            {dryAtt && <div className="flex flex-wrap gap-1.5">{kv(dryAtt)}</div>}
          </div>
        )}

        {blockers.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <ul className="space-y-0.5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={approved}
            disabled={!dry || blockers.length > 0}
            onCheckedChange={(v) => setApproved(v === true)}
          />
          Dry-run 수치를 확인했고 원본 부모 코멘트가 비활성(대체) 처리되는 것에 동의합니다.
        </label>

        <Button
          disabled={!!busy || !approved || !snapshotId || blockers.length > 0}
          onClick={() => void runImport()}
        >
          {busy === "Import 실행 중…" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          5. Atomic V2 Import 실행
        </Button>

        {result && (
          <div className="space-y-2 rounded-md border p-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Import 결과
            </div>
            <div className="flex flex-wrap gap-1.5">
              {kv(result as Record<string, unknown>)}
            </div>
            {verifyOut && <div className="flex flex-wrap gap-1.5">{kv(verifyOut)}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
