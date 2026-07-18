import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Columns3,
  Eye,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  TaskManagementImportProvider,
  useTaskManagementImport,
  type TmFileStatus,
  type TmImportFileItem,
} from "@/contexts/TaskManagementImportContext";
import { DISCIPLINES, type Discipline } from "@/lib/task-management/columns";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import type { RollupMode } from "@/contexts/TaskManagementImportContext";
import { ColumnMappingDialog } from "./ColumnMappingDialog";
import { ConflictDecisionDialog } from "./ConflictDecisionDialog";
import { Input } from "@/components/ui/input";
import type { ConflictPolicy } from "@/contexts/TaskManagementImportContext";
import { AlertTriangle, ScanSearch } from "lucide-react";
import { MasterMappingSection } from "@/components/import/MasterMappingSection";
import {
  applyNameDecisions,
  collectUnresolvedNames,
  formatUnresolvedNamesNote,
  type NameFieldSpec,
} from "@/lib/import/master-name-validation";
import { useAllMasterOptions, type MasterKind, type MasterOption } from "@/hooks/useMasterOptions";
import type { ParsedTaskRow } from "@/lib/task-management/parser";

const statusBadge: Record<TmFileStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
  ready: { label: "Ready", cls: "bg-primary/10 text-primary" },
  processing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
  done: { label: "Done", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskManagementImportPage() {
  return (
    <TaskManagementImportProvider>
      <ImportInner />
    </TaskManagementImportProvider>
  );
}

function ImportInner() {
  const { data: me } = useCurrentUser();
  const canImport = !!me?.isAdmin;
  const {
    files,
    getFiles,
    isRunning,
    rollupMode,
    setRollupMode,
    recalcJudgment,
    setRecalcJudgment,
    addFiles,
    removeFile,
    clearAll,
    setFileDiscipline,
    setFileDataDateOverride,
    setFileColumnOverrides,
    setFileConflictPolicy,
    setFileConflictDecisions,
    clearFileConflictDecisions,
    runPreflight,
    startImport,
    setFileParsedRows,
    setFileMasterMappingNote,
  } = useTaskManagementImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [mappingFileId, setMappingFileId] = useState<string | null>(null);
  const [conflictFileId, setConflictFileId] = useState<string | null>(null);
  const [pendingImportAfterConflicts, setPendingImportAfterConflicts] = useState(false);
  const masterOptions = useAllMasterOptions();

  const nameSpecs: NameFieldSpec<ParsedTaskRow>[] = [
    {
      fieldLabel: "HDEC PIC",
      masterKind: "hdec_pic",
      read: (r) => r.pic,
      write: (r, v) => {
        r.pic = v;
      },
    },
  ];

  const optionsByKind: Record<MasterKind, readonly MasterOption[]> = {
    subcontractor: masterOptions.subcontractor,
    subsub: masterOptions.subsub,
    hdec_pic: masterOptions.hdec_pic,
    hdec_eng: masterOptions.hdec_eng,
  };

  const allReadyRows: ParsedTaskRow[] = files
    .filter((f) => f.status === "ready" && !!f.parsed)
    .flatMap((f) => f.parsed!);

  const unresolvedNames = collectUnresolvedNames(allReadyRows, nameSpecs, optionsByKind);
  const masterMappingNote = formatUnresolvedNamesNote(unresolvedNames);
  const runStartImport = async () => {
    for (const f of files) {
      if (f.status === "ready" && !f.validationError) {
        setFileMasterMappingNote(f.id, masterMappingNote);
      }
    }

    const candidates = getFiles().filter(
      (f) =>
        f.status === "ready" &&
        f.parsed &&
        f.parsed.length > 0 &&
        !f.validationError &&
        !!(f.dataDateOverride ?? f.dataDate),
    );
    if (candidates.length === 0) {
      await startImport();
      return;
    }

    // preflight가 없는 후보는 먼저 점검
    const withoutPreflight = candidates.filter((f) => !f.preflight);
    if (withoutPreflight.length > 0) {
      await Promise.all(withoutPreflight.map((f) => runPreflight(f.id)));
    }

    // 최신 상태를 읽어 미결정 충돌이 있는 파일 확인
    const stillReady = getFiles().filter(
      (f) =>
        f.status === "ready" &&
        f.parsed &&
        f.parsed.length > 0 &&
        !f.validationError &&
        !!(f.dataDateOverride ?? f.dataDate),
    );
    const filesWithUnresolvedConflicts = stillReady.filter((f) => {
      const conflicts = f.preflight?.conflicts ?? [];
      if (conflicts.length === 0) return false;
      const decisions = f.conflictDecisions ?? {};
      return conflicts.some((c) => !decisions[c.task_no]);
    });

    if (filesWithUnresolvedConflicts.length > 0) {
      // 첫 번째 미결정 파일의 충돌 처리 팝업 열기
      setConflictFileId(filesWithUnresolvedConflicts[0].id);
      setPendingImportAfterConflicts(true);
      return;
    }

    await startImport();
  };

  const applyMasterDecisions = (decisions: Map<string, any>) => {
    for (const f of files) {
      if (f.status !== "ready" || !f.parsed) continue;
      const rows = f.parsed.map((r) => ({ ...r }));
      applyNameDecisions(rows, nameSpecs, decisions);
      setFileParsedRows(f.id, rows);
    }
  };

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

  const readyCount = files.filter((f) => f.status === "ready" && !f.validationError).length;
  const previewFile = files.find((f) => f.id === previewFileId) ?? null;
  const mappingFile = files.find((f) => f.id === mappingFileId) ?? null;
  const conflictFile = files.find((f) => f.id === conflictFileId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Task Management — Import</h1>
        <p className="text-sm text-muted-foreground">
          QAIL Task Management Excel(ARCH/ELEC/MECH)의 <code>Gantt</code> 시트를 파싱하여
          <code> task_management_raw</code>에 upsert합니다. 키는{" "}
          <code>(discipline, task_no)</code>.
        </p>
      </div>

      <MasterMappingSection
        entries={unresolvedNames}
        canRegister={canImport}
        optionsByKind={optionsByKind}
        onApply={applyMasterDecisions}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload Files</CardTitle>
          <CardDescription>.xlsx / .xlsm — 다중 파일 지원. 파일별로 공종을 선택합니다.</CardDescription>
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
            <p className="text-xs text-muted-foreground">.xlsx / .xlsm — Gantt 시트만 파싱</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import 옵션</CardTitle>
          <CardDescription>Parent(요약) 행 처리 방식과 판정 재계산 여부를 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium">Parent 행 진도율 처리</Label>
            <RadioGroup
              value={rollupMode}
              onValueChange={(v) => setRollupMode(v as RollupMode)}
              className="grid gap-2"
            >
              <label className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-accent/40">
                <RadioGroupItem value="auto" className="mt-0.5" />
                <div>
                  <div className="font-medium">자동 롤업 (권장, 기본)</div>
                  <div className="text-xs text-muted-foreground">
                    엑셀의 parent 진도율/기간을 무시하고, 자식 행의 duration 가중평균으로 자동 재계산합니다.
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-accent/40">
                <RadioGroupItem value="blank" className="mt-0.5" />
                <div>
                  <div className="font-medium">비어있을 때만 롤업</div>
                  <div className="text-xs text-muted-foreground">
                    parent 값을 그대로 넣되, 이후 롤업 함수가 계산해 채웁니다.
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-accent/40">
                <RadioGroupItem value="keep" className="mt-0.5" />
                <div>
                  <div className="font-medium">엑셀 값 그대로 유지</div>
                  <div className="text-xs text-muted-foreground">
                    엑셀의 parent 값을 그대로 저장하고 롤업을 실행하지 않습니다.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={recalcJudgment}
              onCheckedChange={(v) => setRecalcJudgment(!!v)}
            />
            <span>
              <span className="font-medium">Auto‑judgment 재계산</span>
              <span className="ml-2 text-xs text-muted-foreground">
                Import 후 전체 행의 자동 판정을 임계값 기준으로 다시 계산합니다.
              </span>
            </span>
          </label>
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
                onClick={runStartImport}
                disabled={isRunning || pendingImportAfterConflicts || readyCount === 0 || !canImport}
                title={!canImport ? "관리자 권한이 필요합니다" : ""}
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
                onDisciplineChange={(d) => setFileDiscipline(f.id, d)}
                onPreview={() => setPreviewFileId(f.id)}
                onOpenMapping={() => setMappingFileId(f.id)}
                onDataDateChange={(v) => setFileDataDateOverride(f.id, v)}
                onPolicyChange={(p) => setFileConflictPolicy(f.id, p)}
                onRunPreflight={() => runPreflight(f.id)}
                onOpenConflict={() => setConflictFileId(f.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <PreviewDialog file={previewFile} onClose={() => setPreviewFileId(null)} />
      {conflictFile && (
        <ConflictDecisionDialog
          open={!!conflictFile}
          onClose={() => {
            setConflictFileId(null);
            setPendingImportAfterConflicts(false);
          }}
          fileName={conflictFile.name}
          preflight={conflictFile.preflight ?? null}
          defaultPolicy={conflictFile.conflictPolicy ?? "overwrite"}
          initialDecisions={conflictFile.conflictDecisions}
          onConfirm={(decisions) => {
            setFileConflictDecisions(conflictFile.id, decisions);
            setConflictFileId(null);
            // 가상 상태로 다음 미결정 파일을 검색
            const projectedFiles = files.map((ff) =>
              ff.id === conflictFile.id ? { ...ff, conflictDecisions: decisions } : ff,
            );
            const nextUnresolved = projectedFiles.find((ff) => {
              const conflicts = ff.preflight?.conflicts ?? [];
              if (conflicts.length === 0) return false;
              const d = ff.id === conflictFile.id ? decisions : (ff.conflictDecisions ?? {});
              return conflicts.some((c) => !d[c.task_no]);
            });
            if (nextUnresolved) {
              setConflictFileId(nextUnresolved.id);
            } else if (pendingImportAfterConflicts) {
              setPendingImportAfterConflicts(false);
              void startImport();
            }
          }}
        />
      )}
      {mappingFile && mappingFile.sheetHeaders && mappingFile.columnMap && (
        <ColumnMappingDialog
          open={!!mappingFile}
          onClose={() => setMappingFileId(null)}
          fileName={mappingFile.name}
          sheetHeaders={mappingFile.sheetHeaders}
          currentMap={mappingFile.columnMap}
          defaultMap={mappingFile.columnMap}
          onApply={(overrides) => setFileColumnOverrides(mappingFile.id, overrides)}
        />
      )}
    </div>
  );
}

function FileRow({
  file: f,
  isRunning,
  onRemove,
  onDisciplineChange,
  onPreview,
  onOpenMapping,
  onDataDateChange,
  onPolicyChange,
  onRunPreflight,
  onOpenConflict,
}: {
  file: TmImportFileItem;
  isRunning: boolean;
  onRemove: () => void;
  onDisciplineChange: (d: Discipline) => void;
  onPreview: () => void;
  onOpenMapping: () => void;
  onDataDateChange: (v: string | null) => void;
  onPolicyChange: (p: ConflictPolicy) => void;
  onRunPreflight: () => void;
  onOpenConflict: () => void;
}) {
  const badge = statusBadge[f.status];
  const effectiveDataDate = f.dataDateOverride ?? f.dataDate ?? "";
  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(f.size)}
              {typeof f.parentCount === "number" &&
                ` · Parent ${f.parentCount} / Child ${f.childCount}`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">공종</span>
              <Select
                value={f.discipline ?? ""}
                onValueChange={(v) => onDisciplineChange(v as Discipline)}
                disabled={isRunning || f.status === "done" || f.status === "processing"}
              >
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                      {f.disciplineHint === d ? " (권장)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2 text-xs text-muted-foreground">Data Date</span>
              <Input
                type="date"
                className="h-7 w-[140px] text-xs"
                value={effectiveDataDate}
                onChange={(e) =>
                  onDataDateChange(e.target.value ? e.target.value : null)
                }
                disabled={
                  isRunning || f.status === "done" || f.status === "processing"
                }
              />
              {f.dataDateCell && f.dataDateCell !== "override" && !f.dataDateOverride && (
                <span className="text-[11px] text-muted-foreground">
                  ({f.dataDateCell}에서 감지)
                </span>
              )}
              {f.dataDateOverride && (
                <span className="text-[11px] text-amber-600">(수동 입력)</span>
              )}
              {f.parsed && f.parsed.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onPreview}
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </Button>
              )}
              {f.sheetHeaders && f.columnMap && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onOpenMapping}
                  disabled={
                    isRunning ||
                    f.status === "done" ||
                    f.status === "processing" ||
                    f.status === "parsing"
                  }
                >
                  <Columns3 className="h-3.5 w-3.5" /> 컬럼 매핑
                  {f.columnOverrides &&
                    Object.keys(f.columnOverrides).length > 0 && (
                      <span className="text-amber-600">
                        ({Object.keys(f.columnOverrides).length})
                      </span>
                    )}
                </Button>
              )}
              <span className="ml-2 text-xs text-muted-foreground">충돌 정책</span>
              <Select
                value={f.conflictPolicy ?? "overwrite"}
                onValueChange={(v) => onPolicyChange(v as ConflictPolicy)}
                disabled={isRunning || f.status === "done" || f.status === "processing"}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overwrite" className="text-xs">덮어쓰기</SelectItem>
                  <SelectItem value="skip" className="text-xs">건너뛰기</SelectItem>
                  <SelectItem value="renumber" className="text-xs">자동 재번호</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onRunPreflight}
                disabled={
                  isRunning ||
                  f.status !== "ready" ||
                  !f.parsed ||
                  f.parsed.length === 0 ||
                  f.preflightLoading
                }
              >
                <ScanSearch className="h-3.5 w-3.5" />
                {f.preflightLoading ? "점검중…" : "중복 점검"}
              </Button>
            </div>
            {f.preflight && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                  신규 {f.preflight.newCount}
                </Badge>
                <Badge variant="outline" className="border-blue-300 text-blue-700">
                  업데이트 {f.preflight.updateCount}
                </Badge>
                <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                  변경없음 {f.preflight.unchangedCount}
                </Badge>
                {f.preflight.conflictCount > 0 ? (
                  <>
                    <Badge variant="outline" className="border-destructive text-destructive gap-1">
                      <AlertTriangle className="h-3 w-3" /> 충돌 {f.preflight.conflictCount}
                    </Badge>
                    {(() => {
                      const conflicts = f.preflight.conflicts;
                      const decisions = f.conflictDecisions ?? {};
                      const resolved = conflicts.filter((c) => decisions[c.task_no]).length;
                      const unresolved = conflicts.length - resolved;
                      return (
                        <>
                          {resolved > 0 && (
                            <Badge variant="outline" className="border-violet-300 text-violet-700">
                              개별 결정 {resolved}건
                            </Badge>
                          )}
                          {unresolved > 0 && (
                            <Badge variant="outline" className="border-amber-300 text-amber-700">
                              미결정 {unresolved}건
                            </Badge>
                          )}
                        </>
                      );
                    })()}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-6 px-1 text-xs"
                      onClick={onOpenConflict}
                    >
                      {f.conflictDecisions && Object.keys(f.conflictDecisions).length > 0
                        ? "결정 수정"
                        : "충돌 처리"}
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">충돌 없음</span>
                )}
              </div>
            )}
            {f.preflightError && (
              <p className="mt-1 text-xs text-destructive">중복 점검 실패: {f.preflightError}</p>
            )}
            {f.warnings && f.warnings.length > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ {f.warnings.slice(0, 3).join(" · ")}
                {f.warnings.length > 3 ? ` (+${f.warnings.length - 3})` : ""}
              </p>
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
          {f.result.rejected > 0 && (
            <Badge variant="outline" className="border-destructive text-destructive">
              <AlertCircle className="mr-1 h-3 w-3" /> Rejected: {f.result.rejected}
            </Badge>
          )}
          {typeof f.result.duplicates === "number" && f.result.duplicates > 0 && (
            <Badge variant="outline" className="border-orange-300 text-orange-700">
              Duplicates: {f.result.duplicates}
            </Badge>
          )}
          {typeof f.result.renumbered === "number" && f.result.renumbered > 0 && (
            <Badge variant="outline" className="border-sky-300 text-sky-700">
              Renumbered: {f.result.renumbered}
            </Badge>
          )}
          {typeof f.result.resolvedByDecision === "number" && f.result.resolvedByDecision > 0 && (
            <Badge variant="outline" className="border-violet-300 text-violet-700">
              개별 결정: {f.result.resolvedByDecision}
            </Badge>
          )}
          {f.result.skipped > 0 && (
            <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
              Skipped: {f.result.skipped}
            </Badge>
          )}
          {typeof f.result.rolledUp === "number" && f.result.rolledUp > 0 && (
            <Badge variant="outline" className="border-violet-300 text-violet-700">
              Rollup: {f.result.rolledUp}
            </Badge>
          )}
          {typeof f.result.judgmentRecalculated === "number" &&
            f.result.judgmentRecalculated > 0 && (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                Judgment: {f.result.judgmentRecalculated}
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
              [{e.sampleTaskNo ?? "-"}] {e.code ? `${e.code}: ` : ""}
              {e.message}
              {e.hint ? ` — hint: ${e.hint}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewDialog({
  file,
  onClose,
}: {
  file: TmImportFileItem | null;
  onClose: () => void;
}) {
  const open = !!file;
  const rows = (file?.parsed ?? []).slice(0, 20);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Preview — {file?.name}</DialogTitle>
          <DialogDescription>
            상위 20행 (총 {file?.parsed?.length ?? 0}행). Data Date {file?.dataDate ?? "-"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {[
                  "Task No",
                  "Lv",
                  "Category",
                  "Plot",
                  "항목",
                  "리스크",
                  "세부업무",
                  "담당",
                  "유형",
                  "상태",
                  "계획 시작",
                  "계획 완료",
                  "실적%",
                  "자동판정",
                ].map((h) => (
                  <th key={h} className="border-b px-1.5 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rawRowNo} className="border-b hover:bg-accent/30">
                  <td className="px-1.5 py-1 font-mono">{r.task_no}</td>
                  <td className="px-1.5 py-1">{r.level === "parent" ? "P" : "C"}</td>
                  <td className="px-1.5 py-1">{r.category ?? ""}</td>
                  <td className="px-1.5 py-1">{r.plot ?? ""}</td>
                  <td className="px-1.5 py-1">{r.task_name ?? ""}</td>
                  <td className="px-1.5 py-1">{r.risk ?? ""}</td>
                  <td className="px-1.5 py-1">{r.sub_task_desc ?? ""}</td>
                  <td className="px-1.5 py-1">{r.pic ?? ""}</td>
                  <td className="px-1.5 py-1">{r.row_type ?? ""}</td>
                  <td className="px-1.5 py-1">{r.status_manual ?? ""}</td>
                  <td className="px-1.5 py-1">{r.plan_start ?? ""}</td>
                  <td className="px-1.5 py-1">{r.plan_end ?? ""}</td>
                  <td className="px-1.5 py-1">
                    {r.actual_progress != null
                      ? `${Math.round(r.actual_progress * 100)}%`
                      : ""}
                  </td>
                  <td className="px-1.5 py-1">{r.auto_judgment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}