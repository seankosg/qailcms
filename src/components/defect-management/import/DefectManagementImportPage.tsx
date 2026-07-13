import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Settings2,
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
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  DefectManagementImportProvider,
  useDefectImport,
  type DefectFileStatus,
  type DefectImportFile,
} from "@/contexts/DefectManagementImportContext";
import { DefectColumnSelect } from "./DefectColumnSelect";
import { DuplicateReviewDialog } from "./DuplicateReviewDialog";

const statusBadge: Record<DefectFileStatus, { label: string; cls: string }> = {
  parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
  pending_sheet_selection: {
    label: "Sheet 선택",
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200",
  },
  pending_duplicate_review: {
    label: "중복 검토",
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200",
  },
  ready: { label: "Ready", cls: "bg-primary/10 text-primary" },
  processing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
  done: {
    label: "Done",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function DefectManagementImportPage() {
  return (
    <DefectManagementImportProvider>
      <Inner />
    </DefectManagementImportProvider>
  );
}

function Inner() {
  const { data: me } = useCurrentUser();
  const canImport =
    !!me?.roles?.includes("admin") ||
    !!me?.roles?.includes("superuser") ||
    !!me?.roles?.includes("user");
  const {
    files,
    isRunning,
    addFiles,
    removeFile,
    clearAll,
    setFileDataDateOverride,
    setFileSheet,
    setFileExcludedHeaders,
    setFileDuplicateStrategy,
    setFileDuplicateSelection,
    resolveDuplicates,
    startImport,
  } = useDefectImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [columnDialogFileId, setColumnDialogFileId] = useState<string | null>(null);
  const [dupDialogFileId, setDupDialogFileId] = useState<string | null>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [addFiles],
  );

  const readyCount = files.filter(
    (f) => f.status === "ready" && !f.validationError,
  ).length;
  const columnDialogFile =
    files.find((f) => f.id === columnDialogFileId) ?? null;
  const dupDialogFile = files.find((f) => f.id === dupDialogFileId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Defect Management — Import</h1>
        <p className="text-sm text-muted-foreground">
          LetsBuild 형식 Excel의 첫 시트를 파싱하여 <code> defect_items_raw</code>에 upsert합니다.
          키는 <code>source_issue_no</code>. Team은 각 행의 <b>Category</b> 값에 따라 자동으로 채워집니다
          (매핑 관리: <code>Defect Settings</code>).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload Files</CardTitle>
          <CardDescription>.xlsx / .xlsm — 다중 파일. Team은 Category 자동 매핑.</CardDescription>
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
            <p className="text-xs text-muted-foreground">첫 시트, 행 1이 헤더</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={onSelect}
            />
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">2. Files ({files.length})</CardTitle>
              <CardDescription>{readyCount} ready to import</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={clearAll} disabled={isRunning}>
                Clear all
              </Button>
              <Button
                size="sm"
                onClick={startImport}
                disabled={isRunning || readyCount === 0 || !canImport}
                title={!canImport ? "권한이 필요합니다" : ""}
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
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                isRunning={isRunning}
                onRemove={() => removeFile(f.id)}
                onTeamChange={(t) => setFileTeam(f.id, t)}
                onDataDateChange={(v) => setFileDataDateOverride(f.id, v)}
                onOpenColumnSelect={() => setColumnDialogFileId(f.id)}
                onSheetChange={(sheet) => setFileSheet(f.id, sheet)}
                onOpenDuplicateReview={() => setDupDialogFileId(f.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {columnDialogFile &&
        columnDialogFile.availableHeaders &&
        columnDialogFile.headerToFieldMap && (
          <DefectColumnSelect
            open={!!columnDialogFileId}
            onClose={() => setColumnDialogFileId(null)}
            fileName={columnDialogFile.name}
            headers={columnDialogFile.availableHeaders}
            samples={columnDialogFile.headerSamples ?? {}}
            headerToFieldMap={columnDialogFile.headerToFieldMap}
            defaultExcluded={columnDialogFile.excludedHeaders ?? []}
            isReimport={!!columnDialogFile.isReimport}
            onApply={(excluded) =>
              setFileExcludedHeaders(columnDialogFile.id, excluded)
            }
          />
        )}

      {dupDialogFile && (dupDialogFile.duplicateGroups?.length ?? 0) > 0 && (
        <DuplicateReviewDialog
          file={dupDialogFile}
          open={!!dupDialogFileId}
          onOpenChange={(o) => !o && setDupDialogFileId(null)}
          onChangeStrategy={(s) => setFileDuplicateStrategy(dupDialogFile.id, s)}
          onChangeSelection={(k, i) => setFileDuplicateSelection(dupDialogFile.id, k, i)}
          onConfirm={() => {
            resolveDuplicates(dupDialogFile.id);
            setDupDialogFileId(null);
          }}
        />
      )}
    </div>
  );
}

function FileRow({
  file: f,
  isRunning,
  onRemove,
  onTeamChange,
  onDataDateChange,
  onOpenColumnSelect,
  onSheetChange,
  onOpenDuplicateReview,
}: {
  file: DefectImportFile;
  isRunning: boolean;
  onRemove: () => void;
  onTeamChange: (t: DefectTeam) => void;
  onDataDateChange: (v: string | null) => void;
  onOpenColumnSelect: () => void;
  onSheetChange: (sheet: string) => void;
  onOpenDuplicateReview: () => void;
}) {
  const badge = statusBadge[f.status];
  const rowsCount = f.parsed?.length ?? 0;
  const effectiveDate = f.dataDateOverride ?? "";
  const disabled = isRunning || f.status === "done" || f.status === "processing";
  const totalHeaders = f.availableHeaders?.length ?? 0;
  const excludedCount = f.excludedHeaders?.length ?? 0;
  const selectedHeaders = Math.max(totalHeaders - excludedCount, 0);
  const dupGroupCount = f.duplicateGroups?.length ?? 0;
  const dupRowCount = (f.duplicateGroups ?? []).reduce((s, g) => s + g.rows.length, 0);
  const autoDedup = f.autoDedupedIdenticalCount ?? 0;
  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{f.name}</p>
              {f.isReimport && (
                <Badge
                  variant="outline"
                  className="bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200 text-[10px]"
                >
                  Re-import (Update only)
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatSize(f.size)}
              {rowsCount > 0 && ` · ${rowsCount.toLocaleString()} rows`}
              {f.sheetName && ` · sheet: ${f.sheetName}`}
              {totalHeaders > 0 && ` · ${totalHeaders} headers`}
            </p>
            {f.isReimport && (
              <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
                이 파일은 Re-import 포맷으로 감지되었습니다. 기존 행만 업데이트되며 신규 행은 생성되지 않습니다.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {f.sheetNames && f.sheetNames.length > 1 && (
                <>
                  <span className="text-xs text-muted-foreground">Sheet</span>
                  <Select
                    value={f.sheetName ?? ""}
                    onValueChange={onSheetChange}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-7 w-[180px] text-xs">
                      <SelectValue placeholder="시트 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {f.sheetNames.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <span className="text-xs text-muted-foreground">Team *</span>
              <Select
                value={f.team ?? ""}
                onValueChange={(v) => onTeamChange(v as DefectTeam)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-[110px] text-xs">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {DEFECT_TEAMS.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t}
                      {f.teamHint === t ? " (추정)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2 text-xs text-muted-foreground">Data Date</span>
              <Input
                type="date"
                className="h-7 w-[140px] text-xs"
                value={effectiveDate}
                onChange={(e) => onDataDateChange(e.target.value || null)}
                disabled={disabled}
              />
              {totalHeaders > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onOpenColumnSelect}
                  disabled={disabled || f.status === "parsing"}
                >
                  <Settings2 className="h-3.5 w-3.5" /> 컬럼 선택 (
                  {selectedHeaders}/{totalHeaders})
                </Button>
              )}
            </div>
            {f.categorySummary && f.categorySummary.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Category 감지: {f.categorySummary.join(" · ")}
                {f.teamHint && ` → 추정 team: ${f.teamHint}`}
              </p>
            )}
            {f.warnings && f.warnings.length > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ {f.warnings.slice(0, 3).join(" · ")}
              </p>
            )}
            {(dupGroupCount > 0 || autoDedup > 0) && (
              <div className="mt-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  {dupGroupCount > 0 && (
                    <div>
                      동일 Issue No 중복이 <strong>{dupGroupCount}그룹 ({dupRowCount}행)</strong> 감지되었습니다. 검토 후 진행하세요.
                    </div>
                  )}
                  {autoDedup > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      완전 동일 중복 <strong>{autoDedup}행</strong>은 자동 제거됨.
                    </div>
                  )}
                </div>
                {dupGroupCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={onOpenDuplicateReview}
                    disabled={disabled}
                  >
                    중복 검토
                  </Button>
                )}
              </div>
            )}
            {f.validationError && (
              <div className="mt-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{f.validationError}</span>
              </div>
            )}
            {f.error && (
              <div className="mt-1 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                ⚠ {f.error}
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
      {f.status === "processing" && <Progress value={f.progress} className="mt-2 h-1.5" />}
      {f.result && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Inserted: {f.result.inserted}
          </Badge>
          <Badge variant="outline" className="border-blue-300 text-blue-700">
            Updated: {f.result.updated}
          </Badge>
          {f.result.skippedLocked > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Locked skipped: {f.result.skippedLocked}
            </Badge>
          )}
          {(f.result.skippedReimportNoMatch ?? 0) > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Reimport no-match: {f.result.skippedReimportNoMatch}
            </Badge>
          )}
          {f.result.duplicates > 0 && (
            <Badge variant="outline" className="border-orange-300 text-orange-700">
              Duplicates: {f.result.duplicates}
            </Badge>
          )}
          {f.result.rejected > 0 && (
            <Badge variant="outline" className="border-destructive text-destructive">
              <AlertCircle className="mr-1 h-3 w-3" /> Rejected: {f.result.rejected}
            </Badge>
          )}
        </div>
      )}
      {f.result?.errors && f.result.errors.length > 0 && (
        <div className="mt-2 space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          <div className="font-semibold">
            {f.result.errors.length}개 에러 (처음 5건 표시)
          </div>
          {f.result.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="font-mono">
              [{e.sampleId ?? "-"}] {e.code ? `${e.code}: ` : ""}
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
