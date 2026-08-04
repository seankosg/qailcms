import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, FileJson, FolderUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOcsImportStats, OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import {
  parseOcsManifest,
  matchFolderFiles,
  mimeForExt,
  extOf,
  OCS_MAX_BYTES,
  type OcsManifestEntry,
  type OcsManifestParse,
  type FolderMatchResult,
} from "@/lib/abd/ocs-manifest";

export const Route = createFileRoute("/_authenticated/admin/ocs-import")({
  head: () => ({
    meta: [
      { title: "OCS Import — QAIL CMS" },
      {
        name: "description",
        content: "ABD OCS 첨부 매니페스트 검증 및 이미지 보관함 업로드 관리자 화면.",
      },
      { property: "og:title", content: "OCS Import — QAIL CMS" },
      { property: "og:description", content: "ABD OCS 매니페스트 검증 및 첨부 이미지 업로드." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OcsImportPage,
});

type RowStatus = "대기" | "미매칭" | "업로드" | "완료" | "기존" | "실패";
type UploadRow = {
  entry: OcsManifestEntry;
  file?: File;
  status: RowStatus;
  hash?: "일치" | "불일치" | "해시없음";
  message?: string;
};

const CONCURRENCY = 5;

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 로그인 사용자 client 로 private bucket 을 재귀 조회해 정확한 object path 집합을 만든다. */
async function listExistingPaths(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = (roots.length ? roots : [""]).slice();
  const seen = new Set<string>();

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    let offset = 0;

    for (;;) {
      const { data: items, error } = await supabase.storage
        .from(OCS_BUCKET)
        .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(error.message);
      const list = items ?? [];
      for (const it of list) {
        const path = prefix ? `${prefix}/${it.name}` : it.name;
        if ((it as { id?: string | null }).id) out.push(path);
        else queue.push(path); // 하위 폴더
      }
      if (list.length < 1000) break;
      offset += list.length;
    }
  }
  return out;
}

function OcsImportPage() {
  const fetchStats = useServerFn(getOcsImportStats);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [parsed, setParsed] = useState<OcsManifestParse | null>(null);
  const [manifestName, setManifestName] = useState<string | null>(null);
  const [match, setMatch] = useState<FolderMatchResult | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(0);
  const folderRef = useRef<HTMLInputElement>(null);

  const stats = useQuery({ queryKey: ["abd-ocs-import-stats"], queryFn: () => fetchStats({}) });

  const counts = useMemo(() => {
    const c = { 완료: 0, 기존: 0, 실패: 0, 미매칭: 0, 대기: 0, 업로드: 0 } as Record<
      RowStatus,
      number
    >;
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    const hashOk = rows.filter((r) => r.hash === "일치").length;
    const hashBad = rows.filter((r) => r.hash === "불일치").length;
    const hashNone = rows.filter((r) => r.hash === "해시없음").length;
    return { ...c, hashOk, hashBad, hashNone };
  }, [rows]);

  async function onManifest(file: File) {
    try {
      const res = parseOcsManifest(JSON.parse(await file.text()));
      if (res.entries.length === 0) throw new Error("relative_path 를 가진 항목이 없습니다.");
      setParsed(res);
      setManifestName(file.name);
      setMatch(null);
      setConfirmed(false);
      setRows(res.entries.map((entry) => ({ entry, status: "미매칭" as const })));
      if (folderRef.current) folderRef.current.value = "";
      toast.success(`업로드 대상 ${res.entries.length}건 읽음`);
    } catch (e) {
      toast.error(`매니페스트 읽기 실패: ${(e as Error).message}`);
    }
  }

  function onFolder(files: FileList | null) {
    if (!parsed || !files) return;
    const m = matchFolderFiles(parsed.entries, files);
    setMatch(m);
    setConfirmed(false);
    setRows(
      parsed.entries.map((entry) => {
        const f = m.matched.get(entry.relative_path);
        return { entry, file: f, status: (f ? "대기" : "미매칭") as RowStatus };
      }),
    );
    toast.success(`매칭 ${m.matched.size}건 / 미매칭 ${m.unmatchedManifest.length}건`);
  }

  async function uploadOne(r: UploadRow): Promise<UploadRow> {
    const file = r.file!;
    const ext = extOf(r.entry.relative_path);
    const mime = mimeForExt(ext);
    if (!mime) return { ...r, status: "실패", message: `허용되지 않는 확장자(.${ext})` };
    // 실제 File.type 도 강제 검사 — 확장자만 믿지 않는다(§4)
    const fileType = (file.type || "").toLowerCase();
    if (!fileType) return { ...r, status: "실패", message: "MIME 판별 불가" };
    if (fileType !== mime) {
      return { ...r, status: "실패", message: `MIME 불일치(파일 ${fileType} ≠ 경로 ${mime})` };
    }
    const fmt = (r.entry.image_format ?? "").toLowerCase().replace("jpeg", "jpg");
    const extNorm = ext === "jpeg" ? "jpg" : ext;
    if (fmt && fmt !== extNorm) {
      return {
        ...r,
        status: "실패",
        message: `manifest image_format(${r.entry.image_format}) ≠ 확장자(.${ext})`,
      };
    }
    if (file.size > OCS_MAX_BYTES) return { ...r, status: "실패", message: "8MB 초과" };

    const buf = await file.arrayBuffer();
    const hex = await sha256Hex(buf);
    const hash: UploadRow["hash"] = !r.entry.content_hash
      ? "해시없음"
      : hex === r.entry.content_hash
        ? "일치"
        : "불일치";
    if (hash === "불일치") return { ...r, status: "실패", hash, message: "SHA-256 불일치" };

    const { error } = await supabase.storage
      .from(OCS_BUCKET)
      .upload(r.entry.relative_path, new Blob([buf], { type: mime }), {
        contentType: mime,
        upsert: false,
      });
    if (error)
      return {
        ...r,
        status: "실패",
        hash,
        message: String((error as { message?: string }).message ?? error),
      };
    return { ...r, status: "완료", hash };
  }

  async function onUpload() {
    const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.file && r.status !== "완료");
    if (targets.length === 0) return;
    setUploading(true);
    setDone(0);
    const next = rows.slice();

    // §3 기존 object 선조회 — 존재하는 경로는 업로드 요청 자체를 보내지 않는다.
    let existing = new Set<string>();
    try {
      const roots = Array.from(
        new Set(rows.map((r) => r.entry.relative_path.split("/")[0]).filter(Boolean) as string[]),
      );
      existing = new Set(await listExistingPaths(roots));
      setExistingCount(existing.size);
    } catch (e) {
      setUploading(false);
      toast.error(`기존 파일 조회 실패: ${(e as Error).message}`);
      return;
    }
    for (const t of targets) {
      if (existing.has(next[t.i]!.entry.relative_path)) {
        next[t.i] = { ...next[t.i]!, status: "기존", message: "보관함에 이미 존재 — 건너뜀" };
      }
    }
    setRows(next.slice());
    const pending = targets.filter((t) => next[t.i]!.status !== "기존");
    let cursor = 0;
    let finished = 0;
    async function worker() {
      while (cursor < pending.length) {
        const my = pending[cursor++]!;
        next[my.i] = { ...next[my.i]!, status: "업로드" };
        try {
          next[my.i] = await uploadOne(next[my.i]!);
        } catch (e) {
          next[my.i] = {
            ...next[my.i]!,
            status: "실패",
            message: String((e as Error)?.message ?? e),
          };
        }
        finished += 1;
        setDone(finished);
        if (finished % 20 === 0) setRows(next.slice());
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRows(next.slice());
    setUploading(false);
    const ok = next.filter((r) => r.status === "완료").length;
    const skip = next.filter((r) => r.status === "기존").length;
    const fail = next.filter((r) => r.status === "실패").length;
    toast[fail ? "warning" : "success"](`업로드 완료 ${ok} / 기존 ${skip} / 실패 ${fail}`);
    stats.refetch();
  }

  const progress = rows.length
    ? Math.round((done / Math.max(1, rows.filter((r) => r.file).length)) * 100)
    : 0;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">ABD OCS Import (Stage A1)</h1>
        <p className="text-sm text-muted-foreground">
          이 화면은 이미지 보관함 업로드·검증만 수행합니다. 코멘트/첨부 DB 등록은 Stage B 입니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">현재 DB 현황</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>OCS 코멘트 {stats.data?.comment_count ?? 0}건</span>
          <span>도면 연결 {stats.data?.linked_count ?? 0}건</span>
          <span>첨부 메타 {stats.data?.attachment_count ?? 0}건</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileJson className="h-4 w-4" /> 1. 첨부 매니페스트 (OCS_Final_Attachment_Manifest.json)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept="application/json,.json"
            className="block text-sm"
            onChange={(e) => e.target.files?.[0] && onManifest(e.target.files[0])}
          />
          {parsed && (
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{manifestName}</Badge>
                <span>원본 {parsed.total_raw}건</span>
              </div>
              <div>업로드 대상(relative_path 보유) {parsed.entries.length}건</div>
              <div>이미지 없음(제외) {parsed.skipped_no_path}건</div>
              <div>코멘트 ID 없음 → needs_review 보존 {parsed.needs_review}건</div>
              <div className={parsed.duplicated_attachment_ids.length ? "text-destructive" : ""}>
                중복 attachment_id {parsed.duplicated_attachment_ids.length}건
              </div>
              <div className={parsed.duplicated_paths.length ? "text-destructive" : ""}>
                중복 경로 {parsed.duplicated_paths.length}건
              </div>
              <div className={parsed.invalid_rows.length ? "text-destructive" : ""}>
                형식/용량 오류 {parsed.invalid_rows.length}건
                {parsed.invalid_rows.length > 0 &&
                  ` — ${parsed.invalid_rows
                    .slice(0, 3)
                    .map((r) => `#${r.index} ${r.reason}`)
                    .join(", ")}…`}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderUp className="h-4 w-4" /> 2. 이미지 폴더 선택
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error 브라우저 전용 폴더 선택 속성
            webkitdirectory=""
            className="block text-sm"
            onChange={(e) => onFolder(e.target.files)}
            disabled={!parsed}
          />
          <p className="text-xs text-muted-foreground">
            <b>attachments 폴더가 들어 있는 상위 ocs-db-all 폴더</b>를 선택하십시오(attachments
            폴더를 직접 선택해도 자동 인식합니다). PNG/JPEG, 파일당 최대 8MB. 파일 경로는
            매니페스트의 relative_path 와 정확히 일치해야 하며(파일명만 비교하지 않음), 저장 경로도
            relative_path 를 그대로 사용합니다.
          </p>
          {match && (
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <div>매칭 {match.matched.size}건</div>
              <div className={match.unmatchedManifest.length ? "text-destructive" : ""}>
                매니페스트에 있으나 폴더에 없음 {match.unmatchedManifest.length}건
              </div>
              <div>폴더에만 있는 파일 {match.extraFiles.length}건</div>
              <div>이미지 아닌 파일 {match.nonImageFiles}건</div>
              {existingCount !== null && (
                <div>보관함 기존 object {existingCount}건 (업로드 요청 생략)</div>
              )}
            </div>
          )}
          {match && match.matched.size > 0 && !confirmed && (
            <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>
                위 수치가 맞으면 승인하십시오. 승인 후 {match.matched.size}건을 업로드합니다(기존
                파일은 건너뜀).
              </span>
              <Button size="sm" onClick={() => setConfirmed(true)}>
                수치 확인 및 승인
              </Button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={onUpload}
              disabled={!confirmed || uploading || !match || match.matched.size === 0}
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}업로드 실행 (동시{" "}
              {CONCURRENCY})
            </Button>
            {rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                완료 {counts.완료} / 기존 {counts.기존} / 실패 {counts.실패} / 미매칭{" "}
                {counts.미매칭} · 해시 일치 {counts.hashOk} / 불일치 {counts.hashBad} / 없음{" "}
                {counts.hashNone}
              </span>
            )}
          </div>
          {uploading && <Progress value={progress} />}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. 표본 검증 (상위 50건)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attachment ID</TableHead>
                  <TableHead>Comment ID</TableHead>
                  <TableHead>저장 경로</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>해시</TableHead>
                  <TableHead>비고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r) => (
                  <TableRow key={r.entry.source_attachment_id}>
                    <TableCell className="font-mono text-xs">
                      {r.entry.source_attachment_id}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.entry.source_comment_id ?? <Badge variant="outline">needs_review</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.entry.relative_path}</TableCell>
                    <TableCell>
                      {r.status === "완료" ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <CheckCircle2 className="h-3 w-3" />
                          완료
                        </span>
                      ) : r.status === "실패" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          실패
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.status}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.hash ?? "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.message ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
