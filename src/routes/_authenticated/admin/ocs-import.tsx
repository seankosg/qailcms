import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileJson, FolderUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  validateOcsManifest,
  registerOcsAttachments,
  getOcsImportStats,
  OCS_BUCKET,
  OCS_ALLOWED_MIME,
  OCS_MAX_BYTES,
  type OcsManifestEntry,
  type OcsManifestValidation,
} from "@/lib/abd/ocs-import.functions";

export const Route = createFileRoute("/_authenticated/admin/ocs-import")({
  head: () => ({
    meta: [
      { title: "OCS Import — QAIL CMS" },
      { name: "description", content: "ABD OCS 코멘트 매니페스트 검증 및 첨부 이미지 업로드 관리자 화면." },
      { property: "og:title", content: "OCS Import — QAIL CMS" },
      { property: "og:description", content: "ABD OCS 매니페스트 검증 및 첨부 이미지 업로드." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OcsImportPage,
});

type UploadRow = {
  entry: OcsManifestEntry;
  file?: File;
  status: "대기" | "업로드" | "완료" | "실패";
  message?: string;
};

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function OcsImportPage() {
  const validate = useServerFn(validateOcsManifest);
  const register = useServerFn(registerOcsAttachments);
  const fetchStats = useServerFn(getOcsImportStats);

  const [entries, setEntries] = useState<OcsManifestEntry[]>([]);
  const [manifestName, setManifestName] = useState<string | null>(null);
  const [validation, setValidation] = useState<OcsManifestValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const folderRef = useRef<HTMLInputElement>(null);

  const stats = useQuery({
    queryKey: ["abd-ocs-import-stats"],
    queryFn: () => fetchStats({}),
  });

  async function onManifest(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const list: OcsManifestEntry[] = Array.isArray(json) ? json : (json.files ?? json.entries ?? []);
      if (!Array.isArray(list) || list.length === 0) throw new Error("매니페스트에 항목이 없습니다.");
      setEntries(list);
      setManifestName(file.name);
      setValidation(null);
      setRows(list.map((entry) => ({ entry, status: "대기" as const })));
      toast.success(`매니페스트 ${list.length}건 읽음`);
    } catch (e: any) {
      toast.error(`매니페스트 읽기 실패: ${e.message}`);
    }
  }

  async function onValidate() {
    setValidating(true);
    try {
      const res = await validate({ data: { entries } });
      setValidation(res);
      toast.success("검증 완료");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setValidating(false);
    }
  }

  function onFolder(files: FileList | null) {
    if (!files) return;
    const byName = new Map<string, File>();
    for (const f of Array.from(files)) byName.set(f.name, f);
    setRows((prev) =>
      prev.map((r) => {
        const f = byName.get(r.entry.file_name);
        if (!f) return { ...r, status: "대기", message: "이미지 없음" };
        if (!OCS_ALLOWED_MIME.includes(f.type as any)) return { ...r, file: undefined, status: "실패", message: `허용되지 않는 형식(${f.type || "unknown"})` };
        if (f.size > OCS_MAX_BYTES) return { ...r, file: undefined, status: "실패", message: "8MB 초과" };
        return { ...r, file: f, status: "대기", message: undefined };
      }),
    );
    const matched = Array.from(byName.keys()).length;
    toast.success(`이미지 ${matched}건 선택됨`);
  }

  async function onUpload() {
    const targets = rows.filter((r) => r.file && r.status !== "완료");
    if (targets.length === 0) {
      toast.error("업로드할 이미지가 없습니다.");
      return;
    }
    setUploading(true);
    setProgress(0);
    const registered: Parameters<typeof registerOcsAttachments>[0] extends never ? never : any[] = [];
    let done = 0;
    for (const r of targets) {
      const file = r.file!;
      const path = `${r.entry.source_comment_id}/${r.entry.source_attachment_id}`;
      setRows((prev) => prev.map((x) => (x.entry.source_attachment_id === r.entry.source_attachment_id ? { ...x, status: "업로드" } : x)));
      try {
        const buf = await file.arrayBuffer();
        const hash = await sha256Hex(buf);
        const { error } = await supabase.storage.from(OCS_BUCKET).upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (error) throw new Error(error.message);
        registered.push({
          source_comment_id: r.entry.source_comment_id,
          source_attachment_id: r.entry.source_attachment_id,
          storage_path: path,
          mime_type: file.type,
          byte_size: file.size,
          sha256: hash,
          sort_order: r.entry.sort_order ?? 0,
        });
        setRows((prev) => prev.map((x) => (x.entry.source_attachment_id === r.entry.source_attachment_id ? { ...x, status: "완료", message: undefined } : x)));
      } catch (e: any) {
        setRows((prev) => prev.map((x) => (x.entry.source_attachment_id === r.entry.source_attachment_id ? { ...x, status: "실패", message: e.message } : x)));
      }
      done += 1;
      setProgress(Math.round((done / targets.length) * 100));
    }

    if (registered.length > 0) {
      try {
        const res = await register({ data: { items: registered } });
        toast.success(`DB 등록 ${res.registered}건 완료`);
        if (res.skipped_unknown_comment.length > 0) {
          toast.error(`미등재 코멘트로 건너뜀: ${res.skipped_unknown_comment.length}건`);
        }
        stats.refetch();
      } catch (e: any) {
        toast.error(`DB 등록 실패: ${e.message}`);
      }
    }
    setUploading(false);
  }

  const okCount = rows.filter((r) => r.status === "완료").length;
  const failCount = rows.filter((r) => r.status === "실패").length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">OCS Import (관리자)</h1>
        <p className="text-sm text-muted-foreground">
          매니페스트를 검증하고 OCS 코멘트 첨부 이미지를 비공개 보관함에 업로드합니다. 관리자·Super User 전용.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">OCS 코멘트</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.data?.comment_count ?? "-"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">도면 연결됨</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.data?.linked_count ?? "-"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">등록된 이미지</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.data?.attachment_count ?? "-"}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" /> 1. 매니페스트</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept="application/json,.json"
            className="block text-sm"
            onChange={(e) => e.target.files?.[0] && onManifest(e.target.files[0])}
          />
          <p className="text-xs text-muted-foreground">
            형식: {"{"} "files": [{"{"} "source_comment_id", "source_attachment_id", "file_name", "sort_order" {"}"}] {"}"}
          </p>
          {manifestName && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{manifestName}</Badge>
              <span>{entries.length}건</span>
              <Button size="sm" onClick={onValidate} disabled={validating}>
                {validating && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}검증
              </Button>
            </div>
          )}
          {validation && (
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <div>전체 {validation.total}건 / 실재 코멘트 {validation.known_comment_count}건</div>
              <div className={validation.unknown_comment_ids.length ? "text-destructive" : ""}>
                미등재 코멘트 {validation.unknown_comment_ids.length}건
                {validation.unknown_comment_ids.length > 0 && ` — ${validation.unknown_comment_ids.slice(0, 5).join(", ")}…`}
              </div>
              <div className={validation.duplicated_attachment_ids.length ? "text-destructive" : ""}>
                중복 첨부 ID {validation.duplicated_attachment_ids.length}건
              </div>
              <div className={validation.invalid_rows.length ? "text-destructive" : ""}>
                형식 오류 {validation.invalid_rows.length}건
              </div>
              <div>이미 등록됨 {validation.already_registered.length}건 (재업로드 시 갱신)</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FolderUp className="h-4 w-4" /> 2. 이미지 폴더</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error 브라우저 전용 폴더 선택 속성
            webkitdirectory=""
            className="block text-sm"
            onChange={(e) => onFolder(e.target.files)}
            disabled={entries.length === 0}
          />
          <p className="text-xs text-muted-foreground">
            허용 형식 PNG/JPEG/WebP/GIF, 파일당 최대 8MB. 저장 경로 = {"{source_comment_id}/{source_attachment_id}"}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={onUpload} disabled={uploading || rows.every((r) => !r.file)}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}업로드 및 등록
            </Button>
            {rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                매칭 {rows.filter((r) => r.file).length} / 완료 {okCount} / 실패 {failCount}
              </span>
            )}
          </div>
          {uploading && <Progress value={progress} />}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">3. 표본 검증 (상위 50건)</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comment ID</TableHead>
                  <TableHead>Attachment ID</TableHead>
                  <TableHead>파일명</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>비고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r) => (
                  <TableRow key={r.entry.source_attachment_id}>
                    <TableCell className="font-mono text-xs">{r.entry.source_comment_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.entry.source_attachment_id}</TableCell>
                    <TableCell className="text-xs">{r.entry.file_name}</TableCell>
                    <TableCell>
                      {r.status === "완료" ? (
                        <span className="inline-flex items-center gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />완료</span>
                      ) : r.status === "실패" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />실패</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.status}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.message ?? (r.file ? "" : "이미지 미매칭")}</TableCell>
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
