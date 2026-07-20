import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { parseAbdFile, type ParsedFileResult, detectTeamFromFilename } from "@/lib/abd/parser";
import { importAbdBatch } from "@/lib/abd/mutations.functions";
import { takePreImportSnapshotWithFeedback } from "@/lib/backup/pre-import-snapshot";
import { AbdDuplicateReviewDialog } from "./AbdDuplicateReviewDialog";
import { useTeamOptions } from "@/lib/team/team-master";
import { collectUnknownTeamCodes } from "@/lib/import/team-validation";
import { TeamRegisterDialog } from "@/components/import/TeamRegisterDialog";
import { MasterMappingSection } from "@/components/import/MasterMappingSection";
import {
  applyNameDecisions,
  collectUnresolvedNames,
  formatUnresolvedNamesNote,
  type NameFieldSpec,
} from "@/lib/import/master-name-validation";
import { useAllMasterOptions, type MasterKind, type MasterOption } from "@/hooks/useMasterOptions";
import type { ParsedAbdRow } from "@/lib/abd/parser";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Status = "queued" | "parsing" | "ready" | "importing" | "done" | "error";

interface FileEntry {
  id: string;
  file: File;
  status: Status;
  team: string | null;
  parsed?: ParsedFileResult;
  error?: string;
  result?: {
    inserted: number;
    updated: number;
    inactivated: number;
    total: number;
  };
  progress?: number;
  allowDuplicates?: boolean;
}

const statusBadge: Record<Status, { label: string; cls: string }> = {
  queued: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
  ready: { label: "Ready", cls: "bg-primary/10 text-primary" },
  importing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
  done: {
    label: "Done",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  error: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function AbdImportPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dupOpenId, setDupOpenId] = useState<string | null>(null);
  const { data: teamOptions = [] } = useTeamOptions();
  const currentUserQ = useCurrentUser();
  const canRegisterTeam = !!(currentUserQ.data?.isAdmin || currentUserQ.data?.isSuperUser);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const masterOptions = useAllMasterOptions();

  const nameSpecs: NameFieldSpec<ParsedAbdRow>[] = [
    {
      fieldLabel: "HDEC PIC",
      masterKind: "hdec_pic",
      read: (r) => r.pic,
      write: (r, v) => {
        r.pic = v;
      },
    },
  ];

  const allReadyRows: ParsedAbdRow[] = entries
    .filter((e) => e.status === "ready" && e.parsed)
    .flatMap((e) => e.parsed!.sheets.flatMap((s) => s.rows));

  const optionsByKind: Record<MasterKind, readonly MasterOption[]> = {
    subcontractor: masterOptions.subcontractor,
    subsub: masterOptions.subsub,
    hdec_pic: masterOptions.hdec_pic,
    hdec_eng: masterOptions.hdec_eng,
  };

  const unresolvedNames = collectUnresolvedNames(allReadyRows, nameSpecs, optionsByKind);

  const applyMasterDecisions = (decisions: Map<string, any>) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (!e.parsed) return e;
        const nextSheets = e.parsed.sheets.map((s) => {
          const rows = s.rows.map((r) => ({ ...r }));
          applyNameDecisions(rows, nameSpecs, decisions);
          return { ...s, rows };
        });
        return { ...e, parsed: { ...e.parsed, sheets: nextSheets } };
      }),
    );
  };

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const newEntries: FileEntry[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "queued",
      team: detectTeamFromFilename(f.name, teamOptions),
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    for (const e of newEntries) {
      try {
        setEntries((prev) =>
          prev.map((x) => (x.id === e.id ? { ...x, status: "parsing" } : x)),
        );
        const parsed = await parseAbdFile(e.file, e.team ?? undefined, teamOptions);
        setEntries((prev) =>
          prev.map((x) =>
            x.id === e.id
              ? {
                  ...x,
                  parsed,
                  team: parsed.team_from_filename ?? x.team,
                  status: "ready",
                }
              : x,
          ),
        );
      } catch (err: any) {
        setEntries((prev) =>
          prev.map((x) =>
            x.id === e.id
              ? { ...x, status: "error", error: err?.message ?? String(err) }
              : x,
          ),
        );
      }
    }
  }, [teamOptions]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFiles(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFiles],
  );

  const removeEntry = (id: string) =>
    setEntries((p) => p.filter((x) => x.id !== id));
  const setTeam = (id: string, team: string) =>
    setEntries((p) => p.map((x) => (x.id === id ? { ...x, team } : x)));
  const clearAll = () => setEntries([]);

  // 파싱 완료된 파일 중 미등록 team 코드 수집
  const unknownTeamCodes = collectUnknownTeamCodes(
    entries.filter((e) => e.status === "ready").map((e) => e.team),
    teamOptions,
  );

  const isReady = (e: FileEntry) =>
    e.status === "ready" &&
    !!e.team &&
    !!teamOptions.find((o) => o.code === e.team) &&
    ((e.parsed?.duplicates_in_file.length ?? 0) === 0 || !!e.allowDuplicates);
  const readyCount = entries.filter(isReady).length;
  const isRunning = busy;

  const startImport = async () => {
    setBusy(true);
    try {
      await takePreImportSnapshotWithFeedback("abd");
    } catch {
      // toast 메시지는 takePreImportSnapshotWithFeedback 내부에서 처리
    }
    for (const e of entries) {
      if (!isReady(e) || !e.parsed || !e.team) continue;
      setEntries((p) =>
        p.map((x) => (x.id === e.id ? { ...x, status: "importing", progress: 20 } : x)),
      );
      try {
        const agg = { inserted: 0, updated: 0, inactivated: 0, total: 0 };
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
              allow_duplicates: !!e.allowDuplicates,
              note: formatUnresolvedNamesNote(unresolvedNames) || null,
            } as any,
          });
          agg.inserted += res.inserted;
          agg.updated += res.updated;
          agg.inactivated += res.inactivated;
          agg.total += res.total;
        }
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id ? { ...x, status: "done", result: agg, progress: 100 } : x,
          ),
        );
        toast.success(
          `${e.file.name}: ${agg.inserted} 신규 / ${agg.updated} 변경 / ${agg.inactivated} 비활성`,
        );
      } catch (err: any) {
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id
              ? { ...x, status: "error", error: err?.message ?? String(err) }
              : x,
          ),
        );
        toast.error(`${e.file.name} 임포트 실패: ${err?.message ?? err}`);
      }
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">ABD — Import</h1>
        <p className="text-sm text-muted-foreground">
          원본 엑셀(다단 헤더)을 그대로 업로드하면 자동으로 파싱 · 평탄화 저장합니다. 재업로드 시 ABD_NUMBER 기준 upsert.
        </p>
      </div>

      {unknownTeamCodes.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>미등록 Team 코드 감지</AlertTitle>
          <AlertDescription className="text-xs">
            {unknownTeamCodes.map((c) => (
              <span key={c} className="mr-2 rounded bg-destructive/20 px-2 py-0.5 font-mono">{c}</span>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => setTeamDialogOpen(true)}
            >
              {canRegisterTeam ? "등록하기" : "확인"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <MasterMappingSection
        entries={unresolvedNames}
        canRegister={canRegisterTeam}
        optionsByKind={optionsByKind}
        onApply={applyMasterDecisions}
      />

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>임포트 규칙</AlertTitle>
        <AlertDescription className="text-xs">
          · 시트명이 <code>Bar chart</code>/<code>Subcon</code>/<code>Sheet*</code> 이거나 헤더(Sl.No + ABD NUMBER)가 없으면 자동 제외됩니다.<br />
          · 엑셀 원본의 <code>ABD_NUMBER</code> 및 세그먼트 셀값을 그대로 저장합니다.<br />
          · 동일 <code>ABD_NUMBER</code> 가 파일 내에 2회 이상 있으면 기본적으로 <b>임포트가 차단</b>됩니다. 상세를 확인해 원본을 수정하거나, 중복 허용을 선택할 수 있습니다.<br />
          · 중복을 허용하면 첫 행은 원본 <code>ABD_NUMBER</code> 로 저장되고, 2번째 이후 행은 뒤에 <code>-02</code>, <code>-03</code> … 접미사를 붙여 <b>모두 별도 행으로 저장</b>됩니다.<br />
          · 재업로드 시 동일 <code>ABD_NUMBER</code> 는 업데이트, 새 번호는 삽입, 이번 파일에 없는 도면은 자동으로 <b>비활성(Inactive)</b> 표시됩니다.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload Files</CardTitle>
          <CardDescription>.xlsx 여러 개 가능 (MECH/ELEC/ARCH). 팀은 파일명(설비/전기/건축 또는 MECH/ELEC/ARCH)으로 자동 감지 후 수정 가능.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition hover:border-primary hover:bg-accent/30"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Excel 파일을 드롭하거나 클릭하여 선택</p>
            <p className="text-xs text-muted-foreground">.xlsx / .xls — 다중 파일 지원</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onSelect}
            />
          </div>
        </CardContent>
      </Card>

      {entries.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">2. Files ({entries.length})</CardTitle>
              <CardDescription>{readyCount} ready to import</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={clearAll} disabled={isRunning}>
                Clear all
              </Button>
              <Button
                size="sm"
                onClick={startImport}
                disabled={isRunning || readyCount === 0}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Importing…
                  </>
                ) : (
                  `Start import (${readyCount})`
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {entries.map((e) => (
              <FileRow
                key={e.id}
                entry={e}
                isRunning={isRunning}
                onRemove={() => removeEntry(e.id)}
                onTeamChange={(t) => setTeam(e.id, t)}
                onOpenDuplicates={() => setDupOpenId(e.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {entries.map((e) => (
        <AbdDuplicateReviewDialog
          key={`dup-${e.id}`}
          open={dupOpenId === e.id}
          onOpenChange={(o) => setDupOpenId(o ? e.id : null)}
          fileName={e.file.name}
          duplicates={e.parsed?.duplicates_in_file ?? []}
          allowed={!!e.allowDuplicates}
          onAllow={() =>
            setEntries((p) =>
              p.map((x) => (x.id === e.id ? { ...x, allowDuplicates: true } : x)),
            )
          }
          onRevoke={() =>
            setEntries((p) =>
              p.map((x) => (x.id === e.id ? { ...x, allowDuplicates: false } : x)),
            )
          }
        />
      ))}
      <TeamRegisterDialog
        open={teamDialogOpen}
        unknownCodes={unknownTeamCodes}
        canRegister={canRegisterTeam}
        onClose={() => setTeamDialogOpen(false)}
        onRegistered={() => { /* team_master invalidation via qc; entries의 team 문자열은 유지 */ }}
      />
    </div>
  );
}

function FileRow({
  entry: e,
  isRunning,
  onRemove,
  onTeamChange,
  onOpenDuplicates,
}: {
  entry: FileEntry;
  isRunning: boolean;
  onRemove: () => void;
  onTeamChange: (t: string) => void;
  onOpenDuplicates: () => void;
}) {
  const { data: teamOptions = [] } = useTeamOptions();
  const badge = statusBadge[e.status];
  const disabled = isRunning || e.status === "done" || e.status === "importing";
  const sheetCount = e.parsed?.sheets.length ?? 0;
  const ignoredCount = e.parsed?.ignored_sheets.length ?? 0;
  const totalRows = (e.parsed?.sheets ?? []).reduce((s, sh) => s + sh.rows.length, 0);
  const dupGroups = e.parsed?.duplicates_in_file ?? [];
  const dupRowCount = dupGroups.reduce((s, g) => s + g.occurrences.length, 0);
  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{e.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(e.file.size)}
              {totalRows > 0 && ` · ${totalRows.toLocaleString()} rows`}
              {sheetCount > 0 && ` · ${sheetCount} sheet(s)`}
              {ignoredCount > 0 && ` · ${ignoredCount} ignored`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">팀</span>
              <Select
                value={e.team ?? ""}
                onValueChange={(v) => onTeamChange(v)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {teamOptions.map((t) => (
                    <SelectItem key={t.id} value={t.code} className="text-xs">
                      {t.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {e.parsed && e.parsed.sheets.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                시트 감지:{" "}
                {e.parsed.sheets
                  .map(
                    (s) =>
                      `${s.sheet_name}${s.plot ? ` (Plot ${s.plot})` : ""} ${s.rows.length}행`,
                  )
                  .join(" · ")}
              </p>
            )}
            {e.parsed && ignoredCount > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                제외 시트: {e.parsed.ignored_sheets.join(", ")}
              </p>
            )}
            {dupGroups.length > 0 && (
              <div className={`mt-2 flex items-start gap-2 rounded border p-2 text-xs ${
                e.allowDuplicates
                  ? "border-amber-400/60 bg-amber-100/40 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}>
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">
                    중복 {dupGroups.length}건 ({dupRowCount}행){" "}
                    {e.allowDuplicates ? "— 허용됨 (2번째부터 -02, -03…)" : "— 임포트 차단"}
                  </div>
                  <div className="mt-0.5 text-[11px]">
                    {e.allowDuplicates
                      ? "첫 행은 원본 번호, 2번째 이후는 뒤에 -02, -03 … 접미사를 붙여 모두 저장됩니다."
                      : "동일 ABD_NUMBER 가 반복됩니다. 상세를 확인 후 원본을 수정하거나 중복 허용을 선택하세요."}
                  </div>
                  <button
                    type="button"
                    onClick={onOpenDuplicates}
                    className="mt-1 text-[11px] font-medium underline hover:no-underline"
                  >
                    중복 상세 보기 / 처리 방식 선택
                  </button>
                </div>
              </div>
            )}
            {e.error && (
              <div className="mt-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{e.error}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={badge.cls}>{badge.label}</Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRemove}
            disabled={isRunning}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {e.status === "importing" && (
        <Progress value={e.progress ?? 40} className="mt-2 h-1.5" />
      )}
      {e.result && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Inserted: {e.result.inserted}
          </Badge>
          <Badge variant="outline" className="border-blue-300 text-blue-700">
            Updated: {e.result.updated}
          </Badge>
          {e.result.inactivated > 0 && (
            <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
              Inactivated: {e.result.inactivated}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}