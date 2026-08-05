import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FilePickerButton } from "@/components/shared/FilePickerButton";
import {
  OCS_SOURCE_BUCKET,
  OCS_SOURCE_MAX_BYTES,
  OCS_SOURCE_MIME,
  matchSourceFolder,
  parseOcsSourceManifest,
  sha256Hex,
  type OcsSourceEntry,
  type OcsSourceManifestParse,
} from "@/lib/abd/ocs-source-manifest";

type RowStatus = "대기" | "미매칭" | "기존" | "업로드" | "완료" | "실패";
type Row = {
  entry: OcsSourceEntry;
  file?: File;
  status: RowStatus;
  hash?: "일치" | "불일치" | "해시없음";
  message?: string;
};

const CONCURRENCY = 5;

export function OcsSourceFilesPanel() {
  const [parsed, setParsed] = useState<OcsSourceManifestParse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [folderOnly, setFolderOnly] = useState<string[]>([]);
  const [existing, setExisting] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  const counts = useMemo(() => {
    const by = (s: RowStatus) => rows.filter((r) => r.status === s).length;
    return {
      manifest: parsed?.entries.length ?? 0,
      matched: rows.filter((r) => r.file).length,
      missing: missing.length,
      folderOnly: folderOnly.length,
      existing: by("기존") + existing,
      success: by("완료"),
      failed: by("실패"),
    };
  }, [rows, parsed, missing, folderOnly, existing]);

  const onManifest = async (files: FileList) => {
    const f = files[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const p = parseOcsSourceManifest(json);
      setParsed(p);
      setRows(p.entries.map((entry) => ({ entry, status: "미매칭" })));
      setMissing(p.entries.map((e) => e.relative_path));
      setFolderOnly([]);
      setExisting(0);
      setDone(0);
      toast.success(`매니페스트 ${p.entries.length}건 로드 (무효 ${p.invalid_rows.length}건)`);
    } catch (e) {
      toast.error(`매니페스트 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onFolder = async (files: FileList) => {
    if (!parsed) {
      toast.error("먼저 매니페스트를 선택하세요.");
      return;
    }
    setScanning(true);
    try {
      const m = matchSourceFolder(parsed.entries, files);
      setMissing(m.missing);
      setFolderOnly(m.folderOnly);

      // 이미 등록된 해시 조회 (중복 업로드 방지)
      const { data: known, error } = await supabase
        .from("abd_ocs_source_files")
        .select("content_hash, storage_path");
      if (error) throw new Error(error.message);
      const knownHashes = new Set((known ?? []).map((r) => r.content_hash));
      const knownPaths = new Set((known ?? []).map((r) => r.storage_path));

      const next: Row[] = [];
      let existingCount = 0;
      for (const entry of parsed.entries) {
        const file = m.matched.get(entry.relative_path);
        if (!file) {
          next.push({ entry, status: "미매칭", message: "폴더에 파일 없음" });
          continue;
        }
        if (file.size > OCS_SOURCE_MAX_BYTES) {
          next.push({ entry, file, status: "실패", message: "20MiB 초과" });
          continue;
        }
        const hash = await sha256Hex(file);
        const hashState: Row["hash"] = entry.content_hash
          ? hash === entry.content_hash
            ? "일치"
            : "불일치"
          : "해시없음";
        if (knownHashes.has(hash) || knownPaths.has(entry.storage_path)) {
          existingCount += 1;
          next.push({ entry, file, status: "기존", hash: hashState, message: "이미 등록됨 · skip" });
          continue;
        }
        next.push({
          entry: { ...entry, content_hash: hash },
          file,
          status: hashState === "불일치" ? "실패" : "대기",
          hash: hashState,
          message: hashState === "불일치" ? "매니페스트 해시 불일치" : undefined,
        });
      }
      setRows(next);
      setExisting(0);
      void existingCount;
      toast.success(`매칭 ${m.matched.size}건 / 누락 ${m.missing.length}건`);
    } catch (e) {
      toast.error(`폴더 검사 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  const uploadOne = async (row: Row): Promise<Row> => {
    const { entry, file } = row;
    if (!file) return { ...row, status: "미매칭" };
    const up = await supabase.storage
      .from(OCS_SOURCE_BUCKET)
      .upload(entry.storage_path, file, {
        upsert: false,
        contentType: entry.mime_type || OCS_SOURCE_MIME,
      });
    if (up.error && !/exists/i.test(up.error.message)) {
      return { ...row, status: "실패", message: up.error.message };
    }
    const { error } = await supabase.from("abd_ocs_source_files").insert({
      source_file_id: entry.source_file_id,
      file_name: entry.file_name,
      relative_path: entry.relative_path,
      storage_path: entry.storage_path,
      content_hash: entry.content_hash as string,
      byte_size: file.size,
      mime_type: entry.mime_type || OCS_SOURCE_MIME,
    });
    if (error) {
      if (/duplicate key/i.test(error.message)) {
        return { ...row, status: "기존", message: "이미 등록됨 · skip" };
      }
      return { ...row, status: "실패", message: error.message };
    }
    return { ...row, status: "완료", message: undefined };
  };

  const start = async () => {
    const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "대기" && r.file);
    if (queue.length === 0) {
      toast.error("업로드 대상이 없습니다.");
      return;
    }
    setRunning(true);
    setDone(0);
    let cursor = 0;
    const results = rows.slice();

    const worker = async () => {
      for (;;) {
        const job = queue[cursor++];
        if (!job) return;
        const out = await uploadOne(job.r);
        results[job.i] = out;
        setRows(results.slice());
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);

    const ok = results.filter((r) => r.status === "완료").length;
    const fail = results.filter((r) => r.status === "실패").length;
    toast[fail ? "error" : "success"](`업로드 완료 ${ok}건 · 실패 ${fail}건`);
  };

  const retryFailed = () => {
    setRows((prev) =>
      prev.map((r) => (r.status === "실패" && r.file && r.hash !== "불일치" ? { ...r, status: "대기", message: undefined } : r)),
    );
  };

  const pending = rows.filter((r) => r.status === "대기").length;
  const total = rows.filter((r) => r.status === "대기").length + done;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OCS Source Excel Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          원본 OCS Excel 파일을 비공개 보관함(<code>{OCS_SOURCE_BUCKET}</code>)에 보관합니다. 기존
          object 는 덮어쓰지 않으며(upsert:false), 동일 SHA-256 은 건너뜁니다. 업로드만으로 코멘트
          DB·Complied 는 변경되지 않습니다 (Uploaded for later import).
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <FilePickerButton
            label="Manifest JSON 선택"
            accept="application/json,.json"
            onFiles={(f) => void onManifest(f)}
            disabled={running}
          />
          <FilePickerButton
            label="원본 OCS 폴더 선택"
            directory
            multiple
            onFiles={(f) => void onFolder(f)}
            disabled={!parsed || running || scanning}
          />
          {scanning && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 해시 검사 중…
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Manifest files {counts.manifest}</Badge>
          <Badge variant="outline">Matched {counts.matched}</Badge>
          <Badge variant={counts.missing ? "destructive" : "outline"}>
            Missing {counts.missing}
          </Badge>
          <Badge variant="outline">Folder-only {counts.folderOnly}</Badge>
          <Badge variant="secondary">Existing/skipped {counts.existing}</Badge>
          <Badge variant="secondary">Upload success {counts.success}</Badge>
          <Badge variant={counts.failed ? "destructive" : "secondary"}>
            Upload failure {counts.failed}
          </Badge>
        </div>

        {counts.missing > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <div className="mb-1 inline-flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> 누락 파일 {counts.missing}건 — 승인 시 나머지만
              업로드됩니다.
            </div>
            <div className="max-h-24 overflow-auto font-mono text-[10px] text-muted-foreground">
              {missing.slice(0, 50).map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void start()} disabled={running || pending === 0}>
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            업로드 시작 ({pending})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={retryFailed}
            disabled={running || counts.failed === 0}
          >
            실패 재시도
          </Button>
        </div>

        {running && <Progress value={total ? (done / total) * 100 : 0} />}

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Storage path</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 50).map((r) => (
                <TableRow key={r.entry.storage_path}>
                  <TableCell className="font-mono text-xs">{r.entry.file_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.entry.storage_path}</TableCell>
                  <TableCell className="text-xs">
                    {r.status === "완료" ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> 완료
                      </span>
                    ) : r.status === "실패" ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3 w-3" /> 실패
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.status}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{r.hash ?? "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.message ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.length > 50 && (
          <p className="text-[10px] text-muted-foreground">최근 50행만 표시합니다.</p>
        )}
      </CardContent>
    </Card>
  );
}