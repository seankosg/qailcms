import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, X, Play, ArrowLeft, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { parseAbdFile, type ParsedFileResult, detectTeamFromFilename } from "@/lib/abd/parser";
import { importAbdBatch } from "@/lib/abd/mutations.functions";
import { ABD_TEAMS, TEAM_LABEL, type AbdTeam } from "@/lib/abd/columns";

type Status = "queued" | "parsing" | "ready" | "importing" | "done" | "error";

interface FileEntry {
  id: string;
  file: File;
  status: Status;
  team: AbdTeam | null;
  parsed?: ParsedFileResult;
  error?: string;
  result?: { inserted: number; updated: number; inactivated: number; mismatched: number; total: number };
}

export function AbdImportPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newEntries: FileEntry[] = [];
    for (const f of Array.from(files)) {
      newEntries.push({
        id: crypto.randomUUID(),
        file: f,
        status: "queued",
        team: detectTeamFromFilename(f.name),
      });
    }
    setEntries((prev) => [...prev, ...newEntries]);
    // parse each in background
    for (const e of newEntries) {
      try {
        setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: "parsing" } : x)));
        const parsed = await parseAbdFile(e.file, e.team ?? undefined);
        setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, parsed, team: parsed.team_from_filename ?? x.team, status: "ready" } : x)));
      } catch (err: any) {
        setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: "error", error: err?.message ?? String(err) } : x)));
      }
    }
  }, []);

  const removeEntry = (id: string) => setEntries((p) => p.filter((x) => x.id !== id));
  const setTeam = (id: string, team: AbdTeam) => setEntries((p) => p.map((x) => (x.id === id ? { ...x, team } : x)));

  const canStart = entries.length > 0 && entries.every((e) => e.status === "ready" && e.team);

  const startImport = async () => {
    setBusy(true);
    for (const e of entries) {
      if (e.status !== "ready" || !e.parsed || !e.team) continue;
      setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, status: "importing" } : x)));
      try {
        // combine all sheets into one call per (team, plot)? Simpler: one call per sheet.
        let agg = { inserted: 0, updated: 0, inactivated: 0, mismatched: 0, total: 0 };
        for (const sheet of e.parsed.sheets) {
          const rows = sheet.rows.map((r) => ({ ...r, plot: r.plot ?? sheet.plot ?? null }));
          const res = await importAbdBatch({
            data: {
              file_name: e.file.name,
              team: e.team,
              plot: sheet.plot,
              sheet_name: sheet.sheet_name,
              data_date: new Date().toISOString().slice(0, 10),
              rows,
              inactivate_missing: true,
            } as any,
          });
          agg.inserted += res.inserted;
          agg.updated += res.updated;
          agg.inactivated += res.inactivated;
          agg.mismatched += res.mismatched;
          agg.total += res.total;
        }
        setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, status: "done", result: agg } : x)));
        toast.success(`${e.file.name}: ${agg.inserted} 신규 / ${agg.updated} 변경 / ${agg.inactivated} 비활성 / ${agg.mismatched} 필드 mismatch`);
      } catch (err: any) {
        setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, status: "error", error: err?.message ?? String(err) } : x)));
        toast.error(`${e.file.name} 임포트 실패: ${err?.message ?? err}`);
      }
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ABD Import</h1>
          <p className="text-sm text-muted-foreground">
            원본 엑셀(다단 헤더)을 그대로 업로드하면 자동으로 파싱 · 평탄화 저장합니다. 재업로드 시 ABD_NUMBER 기준 upsert.
          </p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/closure/abd/raw-data"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Raw Data</Link></Button>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>임포트 규칙</AlertTitle>
        <AlertDescription className="text-xs">
          · 시트명이 <code>Bar chart</code>/<code>Subcon</code>/<code>Sheet*</code> 이거나 헤더(Sl.No + ABD NUMBER)가 없으면 자동 제외됩니다.<br />
          · ABD_NUMBER 로부터 <code>plot / dis / doc_ax..doc_nn2</code> 를 재파싱하며, 원본 셀값과 다르면 <b>field_mismatch</b> 로 저장됩니다.<br />
          · 재업로드 시 동일 <code>ABD_NUMBER</code> 는 업데이트, 새 번호는 삽입, 이번 파일에 없는 도면은 자동으로 <b>비활성(Inactive)</b> 표시됩니다.
        </AlertDescription>
      </Alert>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-8 hover:bg-muted/40">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">Excel 파일을 클릭 또는 드래그하여 업로드</span>
        <span className="text-xs text-muted-foreground">.xlsx 여러 개 가능 (설비/전기/건축)</span>
        <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </label>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-md border bg-card p-3">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="mt-0.5 h-5 w-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.file.name}</span>
                    <Badge variant="outline" className="text-[10px]">{(e.file.size / 1024).toFixed(0)} KB</Badge>
                    <StatusBadge status={e.status} />
                  </div>

                  {e.status === "parsing" && <Progress value={40} className="mt-2 h-1" />}

                  {e.parsed && (
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">팀:</span>
                        <Select value={e.team ?? ""} onValueChange={(v) => setTeam(e.id, v as AbdTeam)}>
                          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue placeholder="선택..." /></SelectTrigger>
                          <SelectContent>
                            {ABD_TEAMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">시트: {e.parsed.sheets.length}</span>
                        {e.parsed.ignored_sheets.length > 0 && <span className="text-muted-foreground/70">(제외 {e.parsed.ignored_sheets.length}: {e.parsed.ignored_sheets.join(", ")})</span>}
                      </div>
                      <div className="rounded border bg-muted/30 p-2 text-[11px]">
                        {e.parsed.sheets.map((s) => (
                          <div key={s.sheet_name} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{s.sheet_name}</span>
                            {s.plot && <Badge variant="outline" className="text-[10px]">Plot {s.plot}</Badge>}
                            <span className="text-muted-foreground">{s.rows.length.toLocaleString()} 행</span>
                            {s.skipped_no_key > 0 && <span className="text-amber-600">키 없음 스킵 {s.skipped_no_key}</span>}
                            {(() => {
                              const mm = s.rows.filter((r) => r.field_mismatch).length;
                              return mm > 0 ? <span className="text-orange-600">필드 mismatch {mm}</span> : null;
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {e.result && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">신규 {e.result.inserted}</span>
                      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-700">변경 {e.result.updated}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">비활성 {e.result.inactivated}</span>
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700">Mismatch {e.result.mismatched}</span>
                    </div>
                  )}

                  {e.error && <div className="mt-2 text-xs text-destructive">{e.error}</div>}
                </div>
                <button className="text-muted-foreground/70 hover:text-destructive" onClick={() => removeEntry(e.id)} disabled={busy} title="제거">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setEntries([])} disabled={busy || entries.length === 0}>모두 지우기</Button>
        <Button size="sm" onClick={startImport} disabled={busy || !canStart}>
          <Play className={cn("mr-1.5 h-3.5 w-3.5", busy && "animate-pulse")} />
          {busy ? "임포트 중..." : "Start Import"}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    queued: { label: "대기", cls: "bg-muted text-muted-foreground" },
    parsing: { label: "파싱중", cls: "bg-sky-500/15 text-sky-700" },
    ready: { label: "준비", cls: "bg-emerald-500/15 text-emerald-700" },
    importing: { label: "임포트중", cls: "bg-amber-500/15 text-amber-700" },
    done: { label: "완료", cls: "bg-emerald-500/15 text-emerald-700" },
    error: { label: "오류", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status];
  return <Badge className={cn("text-[10px]", m.cls)}>{m.label}</Badge>;
}