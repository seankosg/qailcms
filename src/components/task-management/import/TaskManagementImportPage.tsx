import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRclGrants } from "@/hooks/useRclCan";
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
import { DateIssuesPanel } from "@/components/import/DateIssuesPanel";
import type { RollupMode } from "@/contexts/TaskManagementImportContext";
import { TaskColumnSelect } from "./TaskColumnSelect";
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
import { useModuleGuard } from "@/hooks/useModuleGuard";
import { ModuleGuardDialog } from "@/components/import/ModuleGuardDialog";
import { useAllMasterOptions, type MasterKind, type MasterOption } from "@/hooks/useMasterOptions";
import type { ParsedTaskRow } from "@/lib/task-management/parser";

const statusBadge: Record<TmFileStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
  pending_sheet_selection: {
    label: "시트 선택 대기",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
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
  const canImport = !!me?.isEditor;
  // TM 임포트 전용 admin 판정 — superuser 는 제외한다(전역 useCurrentUser 는 수정하지 않음).
  // superuser/d_superuser 는 스코프를 '드롭다운으로 선택'하는 것이 설계 의도다.
  const isAdmin = (me?.roles ?? []).includes("admin");
  // D. 역할 이름 하드코딩 금지 — rcl_grants('TM','import') 가 유일한 근거.
  const { data: tmImportGrants } = useRclGrants("TM", "import");
  const canChooseScope = !!(tmImportGrants?.own_team || tmImportGrants?.other_team);
  const {
    files,
    getFiles,
    isRunning,
    isCancelling,
    requestCancel,
    rollupMode,
    setRollupMode,
    recalcJudgment,
    setRecalcJudgment,
    importScope,
    setImportScope,
    setImporterHdecPicName,
    setImporterOwnNames,
    setImporterTeam,
    setIsImporterAdmin,
    matchesHdecPic,
    addFiles,
    removeFile,
    clearAll,
    setFileDiscipline,
    setFileDataDateOverride,
    setFileSheet,
    setFileExcludedHeaders,
    setFileDateOverrides,
    setFileConflictPolicy,
    setFileAckUnmapped,
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
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const masterOptions = useAllMasterOptions();
  const guard = useModuleGuard("tm", (fs) => addFiles(fs));

  // Sync importer identity/scope to context whenever user info changes
  const hdecPic = me?.hdec_pic_name ?? null;
  // 서버 Own 정의(owner_cols = hdec_pic_name | hdec_eng_name)와 동일 기준으로 mine 판정
  const ownNames = useMemo(
    () =>
      Array.from(
        new Set(
          [me?.hdec_pic_name, me?.hdec_eng_name, me?.name].filter(
            (v): v is string => !!v && v.trim() !== "",
          ),
        ),
      ),
    [me?.hdec_pic_name, me?.hdec_eng_name, me?.name],
  );
  const ownNamesLabel = ownNames.join(", ");
  const adminFlag = isAdmin;
  const myTeam = (me?.team ?? "").trim() || null;
  useEffect(() => {
    setImporterHdecPicName(hdecPic);
    setImporterOwnNames(ownNames);
    setImporterTeam(myTeam);
    setIsImporterAdmin(adminFlag);
  }, [hdecPic, ownNames, myTeam, adminFlag, setImporterHdecPicName, setImporterOwnNames, setImporterTeam, setIsImporterAdmin]);

  // Effective scope for display/counts
  const effectiveScope: "mine" | "all" = isAdmin ? "all" : importScope;

  const nameSpecs: NameFieldSpec<ParsedTaskRow>[] = [
    {
      fieldLabel: "HDEC PIC",
      masterKind: "hdec_pic",
      read: (r) => r.hdec_pic_name,
      write: (r, v) => {
        r.hdec_pic_name = v;
      },
    },
    {
      fieldLabel: "HDEC ENG",
      masterKind: "hdec_eng",
      read: (r) => r.hdec_eng_name,
      write: (r, v) => {
        r.hdec_eng_name = v;
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
      void guard.receive(Array.from(e.dataTransfer.files));
    },
    [guard],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void guard.receive(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [guard],
  );

  // 행수 표기 — 스코프 판정은 서버(rcl_can 'import')가 하므로 클라이언트는
  // 전송 대상 행수만 센다. 제외된 행은 임포트 결과의 "범위 밖 미반영" 목록에 노출된다.
  const matchedByFile = useMemo(() => {
    const map: Record<string, { matched: number; total: number; mine: number }> = {};
    for (const f of files) {
      const rows = f.parsed ?? [];
      map[f.id] = {
        matched: rows.length,
        total: rows.length,
        // mine/all 토글의 추가 축소분(서버 허용 집합 위에 얹힘) 미리보기 — 게이트가 아니라 안내용
        mine: rows.filter((r) => matchesHdecPic(r)).length,
      };
    }
    return map;
  }, [files, effectiveScope, matchesHdecPic]);

  // C. 미매핑·강등이 있으면 사용자가 명시적으로 승인하기 전까지 Start 를 막는다.
  // 단, team 은 파일에 열이 없어도 실행자 소속(profiles.team)으로 채워지므로
  // 내 소속이 있는 한 "제외될 컬럼"이 아니다 — 안내만 한다.
  const teamAutoFilled = (f: (typeof files)[number]) =>
    (f.unmappedFields ?? []).includes("team") && !!myTeam;
  const visibleUnmapped = (f: (typeof files)[number]) =>
    (f.unmappedFields ?? []).filter((x) => !(x === "team" && !!myTeam));
  const hasUnapprovedUnmapped = files.some(
    (f) =>
      f.status === "ready" &&
      (visibleUnmapped(f).length > 0 || (f.demotedFields?.length ?? 0) > 0) &&
      !f.ackUnmapped,
  );
  const readyFiles = files.filter(
    (f) => f.status === "ready" && !f.validationError && !!f.discipline,
  );
  // ③ 전건 team 미확정이면 조용한 0행 임포트 금지 — Start 를 막는다.
  const noTeamBlockedFiles = readyFiles.filter(
    (f) =>
      (f.parsed?.length ?? 0) > 0 &&
      (f.parsed ?? []).every((r) => !((r.team ?? "").trim()) ) &&
      !myTeam,
  );
  const hasNoTeamBlock = noTeamBlockedFiles.length > 0;
  const readyCount = readyFiles.length;
  const totalMatched = readyFiles.reduce(
    (s, f) => s + (matchedByFile[f.id]?.matched ?? 0),
    0,
  );
  const startDisabled =
    isRunning || readyCount === 0 || !canImport || hasUnapprovedUnmapped || hasNoTeamBlock;
  const onStartClick = () => {
    if (effectiveScope === "all") {
      setConfirmAllOpen(true);
      return;
    }
    void runStartImport();
  };
  const previewFile = files.find((f) => f.id === previewFileId) ?? null;
  const columnFile = files.find((f) => f.id === mappingFileId) ?? null;
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
          <CardDescription>Main Task(요약) 행 처리 방식과 판정 재계산 여부를 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium">Main Task 행 진도율 처리</Label>
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
                    엑셀의 Main Task 진도율/기간을 무시하고, Sub Task 행의 duration 가중평균으로 자동 재계산합니다.
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
              <CardDescription>
                {readyCount} ready · 임포트 대상 {totalMatched}행
                {` · 스코프: ${
                  isAdmin
                    ? "전체(Admin — 강제)"
                    : effectiveScope === "mine"
                      ? "본인 담당 행(PIC 또는 ENG)만"
                      : "전체(Super User 선택)"
                }`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isAdmin && (
                canChooseScope ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">임포트 스코프</span>
                    <Select
                      value={importScope}
                      onValueChange={(v) => setImportScope(v as "mine" | "all")}
                      disabled={isRunning}
                    >
                      <SelectTrigger className="h-8 w-[220px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mine" className="text-xs">
                          본인 담당 행(PIC 또는 ENG)만 (기본)
                        </SelectItem>
                        <SelectItem value="all" className="text-xs">
                          Super User: 전체 임포트
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[11px]">
                    본인 담당 행(PIC 또는 ENG)만
                    {ownNamesLabel ? ` (${ownNamesLabel})` : ""}
                  </Badge>
                )
              )}
              <Button variant="outline" size="sm" onClick={clearAll} disabled={isRunning}>
                Clear all
              </Button>
              {isRunning && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={requestCancel}
                  disabled={isCancelling}
                >
                  {isCancelling ? "취소 중…" : "취소"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={onStartClick}
                disabled={startDisabled || pendingImportAfterConflicts}
                title={
                  !canImport
                    ? "임포트 권한이 없습니다"
                    : hasNoTeamBlock
                      ? "팀 열이 없고 내 소속(profiles.team)도 비어 있어 판정할 수 없습니다. 관리자에게 소속 지정을 요청하세요."
                      : hasUnapprovedUnmapped
                      ? "미매핑·강등 컬럼이 있습니다 — 파일 카드에서 '이 컬럼들 없이 진행'을 체크하세요"
                      : ""
                }
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Importing…
                  </>
                ) : (
                  `Start import (${totalMatched}행)`
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasNoTeamBlock && (
              <div className="rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
                팀 열이 없고 내 소속(profiles.team)도 비어 있어 판정할 수 없습니다. 관리자에게
                소속 지정을 요청하세요. (대상 파일: {noTeamBlockedFiles.map((f) => f.name).join(", ")})
              </div>
            )}
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                isRunning={isRunning}
                matched={matchedByFile[f.id]?.matched ?? 0}
                total={matchedByFile[f.id]?.total ?? 0}
                mine={matchedByFile[f.id]?.mine ?? 0}
                scopeIsMine={!isAdmin && effectiveScope === "mine"}
                onRemove={() => removeFile(f.id)}
                onDisciplineChange={(d) => setFileDiscipline(f.id, d)}
                onPreview={() => setPreviewFileId(f.id)}
                onOpenColumnSelect={() => setMappingFileId(f.id)}
                onSheetChange={(s) => setFileSheet(f.id, s)}
                onDataDateChange={(v) => setFileDataDateOverride(f.id, v)}
                onPolicyChange={(p) => setFileConflictPolicy(f.id, p)}
                onRunPreflight={() => runPreflight(f.id)}
                onOpenConflict={() => setConflictFileId(f.id)}
                onDateOverridesApply={(ov) => setFileDateOverrides(f.id, ov)}
                onAckUnmappedChange={(v) => setFileAckUnmapped(f.id, v)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <PreviewDialog file={previewFile} onClose={() => setPreviewFileId(null)} />
      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>전체 스코프로 임포트합니다</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {isAdmin
                    ? "Admin 권한이므로 스코프가 '전체'로 강제됩니다."
                    : "'전체' 스코프를 선택하셨습니다."}{" "}
                  본인 담당이 아닌 행의 진도율·일정·담당자(HDEC PIC)까지 파일 값으로 덮어씁니다.
                </p>
                <div className="rounded border p-2">
                  <div className="font-medium">영향 행수 — 총 {totalMatched}행</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {readyFiles.map((f) => (
                      <li key={f.id}>
                        {f.name} · {matchedByFile[f.id]?.matched ?? 0}행
                        {ownNames.length > 0
                          ? ` (본인 담당(PIC 또는 ENG) 매칭 ${matchedByFile[f.id]?.mine ?? 0}행)`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAllOpen(false);
                void runStartImport();
              }}
            >
              전체 임포트 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      {columnFile && columnFile.availableHeaders && columnFile.headerToFieldMap && (
        <TaskColumnSelect
          fileName={columnFile.name}
          headers={columnFile.availableHeaders}
          samples={columnFile.headerSamples ?? {}}
          headerToFieldMap={columnFile.headerToFieldMap}
          defaultExcluded={columnFile.excludedHeaders ?? []}
          open={!!columnFile}
          onClose={() => setMappingFileId(null)}
          onApply={(excluded) => setFileExcludedHeaders(columnFile.id, excluded)}
        />
      )}
      <ModuleGuardDialog {...guard.dialogProps} />
    </div>
  );
}

function FileRow({
  file: f,
  isRunning,
  matched,
  total,
  mine,
  scopeIsMine,
  onRemove,
  onDisciplineChange,
  onPreview,
  onOpenColumnSelect,
  onSheetChange,
  onDataDateChange,
  onPolicyChange,
  onRunPreflight,
  onOpenConflict,
  onDateOverridesApply,
  onAckUnmappedChange,
}: {
  file: TmImportFileItem;
  isRunning: boolean;
  matched: number;
  total: number;
  mine: number;
  scopeIsMine: boolean;
  onRemove: () => void;
  onDisciplineChange: (d: Discipline | null) => void;
  onPreview: () => void;
  onOpenColumnSelect: () => void;
  onSheetChange: (sheet: string) => void;
  onDataDateChange: (v: string | null) => void;
  onPolicyChange: (p: ConflictPolicy) => void;
  onRunPreflight: () => void;
  onOpenConflict: () => void;
  onDateOverridesApply: (overrides: Record<string, string>) => void | Promise<void>;
  onAckUnmappedChange: (v: boolean) => void;
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
            {total > 0 && (
              <p className="mt-0.5 text-[11px]">
                {scopeIsMine ? (
                  <span className="text-primary">
                    서버 권한 판정 대상 {matched}행 · 그중 본인 담당 행(PIC 또는 ENG) {mine}행만 반영
                    (파싱 {total}행)
                  </span>
                ) : (
                  <span className="text-muted-foreground">전체 {total}행 임포트</span>
                )}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">공종</span>
              <Select
                value={f.discipline ?? "__none"}
                onValueChange={(v) =>
                  onDisciplineChange(v === "__none" ? null : (v as Discipline))
                }
                disabled={isRunning || f.status === "done" || f.status === "processing"}
              >
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue placeholder="공종 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-xs">
                    선택없음
                  </SelectItem>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                      {f.disciplineHint === d ? " (권장)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {f.sheetNames && f.sheetNames.length > 1 && (
                <>
                  <span className="ml-2 text-xs text-muted-foreground">시트</span>
                  <Select
                    value={f.sheetName ?? ""}
                    onValueChange={(v) => onSheetChange(v)}
                    disabled={isRunning || f.status === "done" || f.status === "processing"}
                  >
                    <SelectTrigger className="h-7 w-[160px] text-xs">
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
              {f.availableHeaders && f.availableHeaders.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onOpenColumnSelect}
                  disabled={
                    isRunning ||
                    f.status === "done" ||
                    f.status === "processing" ||
                    f.status === "parsing"
                  }
                >
                  <Columns3 className="h-3.5 w-3.5" /> 컬럼 선택
                  {f.excludedHeaders && f.excludedHeaders.length > 0 && (
                    <span className="text-amber-600">
                      (제외 {f.excludedHeaders.length})
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
                  f.status === "done" ||
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
            {f.preflight && f.preflight.regressionCount > 0 && (
              <details className="mt-2 rounded border border-amber-300 bg-amber-50/60 p-2 text-xs">
                <summary className="cursor-pointer font-medium text-amber-800">
                  진도율 하향 {f.preflight.regressionCount}건
                  {f.preflight.uncompleteCount > 0
                    ? ` (완료 취소 ${f.preflight.uncompleteCount}건 포함)`
                    : ""}
                </summary>
                <table className="mt-2 w-full">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr className="[&>th]:px-1 [&>th]:py-0.5 [&>th]:text-left">
                      <th className="w-28">task_no</th>
                      <th>task_name</th>
                      <th className="w-20">이전</th>
                      <th className="w-20">이후</th>
                      <th className="w-20">구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.preflight.regressions.map((r) => (
                      <tr key={r.task_no} className="border-t border-amber-200 align-top">
                        <td className="px-1 py-0.5 font-mono text-[11px]">{r.task_no}</td>
                        <td className="px-1 py-0.5">{r.task_name ?? "—"}</td>
                        <td className="px-1 py-0.5">
                          {r.kind === "finish_cleared"
                            ? (r.previous_finish ?? "—")
                            : r.previous == null
                              ? "—"
                              : `${(r.previous * 100).toFixed(1)}%`}
                        </td>
                        <td className="px-1 py-0.5">
                          {r.kind === "finish_cleared"
                            ? "(공란)"
                            : r.next == null
                              ? "—"
                              : `${(r.next * 100).toFixed(1)}%`}
                        </td>
                        <td className="px-1 py-0.5">
                          {r.kind === "finish_cleared" ? (
                            <span className="font-medium text-destructive">완료일 삭제</span>
                          ) : r.kind === "uncomplete" ? (
                            <span className="font-medium text-destructive">완료 취소</span>
                          ) : (
                            "하향"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            {f.preflightError && (
              <p className="mt-1 text-xs text-destructive">중복 점검 실패: {f.preflightError}</p>
            )}
            {f.warnings && f.warnings.length > 0 && (
              // C. 경고를 접지 않는다 — 전부 노출.
              <ul className="mt-1 space-y-0.5 text-xs text-amber-600">
                {f.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {teamAutoFilled(f) && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">team</span>: 파일에 열 없음 — 내 소속(
                <span className="font-mono">{myTeam}</span>)으로 채웁니다
              </p>
            )}
            {(visibleUnmapped(f).length > 0 ||
              (f.demotedFields?.length ?? 0) > 0) && (
              <div className="mt-2 space-y-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <div className="font-semibold text-destructive">
                  임포트에서 제외될 컬럼이 있습니다 — 확인 후 진행하세요
                </div>
                {visibleUnmapped(f).length > 0 && (
                  <div>
                    <span className="font-medium">미매핑(헤더 없음): </span>
                    <span className="font-mono">{visibleUnmapped(f).join(", ")}</span>
                  </div>
                )}
                {(f.demotedFields ?? []).map((d) => (
                  <div key={d.field}>
                    <span className="font-medium">강등: </span>
                    <span className="font-mono">{d.field}</span> — {d.reason} (
                    {Math.round(d.ratio * 100)}% / 모집단 {d.population}) · 표본:{" "}
                    <span className="font-mono">{d.samples.join(", ")}</span>
                  </div>
                ))}
                <label className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!f.ackUnmapped}
                    disabled={isRunning}
                    onChange={(e) => onAckUnmappedChange(e.target.checked)}
                  />
                  <span>
                    이 컬럼들 없이 진행:{" "}
                    <span className="font-mono">
                      {[
                        ...visibleUnmapped(f),
                        ...(f.demotedFields ?? []).map((d) => d.field),
                      ].join(", ")}
                    </span>
                  </span>
                </label>
              </div>
            )}
            {f.validationError && (
              <div className="mt-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{f.validationError}</span>
              </div>
            )}
            {f.dateIssues && f.dateIssues.length > 0 && (
              <div className="mt-2">
                <DateIssuesPanel
                  fileName={f.name}
                  sheetName={f.sheetName ?? null}
                  issues={f.dateIssues}
                  currentOverrides={f.dateOverrides}
                  onApply={onDateOverridesApply}
                  disabled={isRunning}
                />
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
          {typeof f.result.outOfScope === "number" && f.result.outOfScope > 0 && (
            <Badge variant="outline" className="border-orange-400 text-orange-700">
              범위 밖 미반영: {f.result.outOfScope}
            </Badge>
          )}
          {typeof f.result.excludedByScope === "number" && f.result.excludedByScope > 0 && (
            <Badge variant="outline" className="border-amber-400 text-amber-700">
              본인 담당 아님으로 제외: {f.result.excludedByScope}
            </Badge>
          )}
          {typeof f.result.excludedNoTeam === "number" && f.result.excludedNoTeam > 0 && (
            <Badge variant="outline" className="border-rose-400 text-rose-700">
              팀 미확정으로 제외: {f.result.excludedNoTeam}
            </Badge>
          )}
          {typeof f.result.unclassified === "number" && f.result.unclassified > 0 && (
            <Badge variant="outline" className="border-destructive text-destructive">
              미분류: {f.result.unclassified}
            </Badge>
          )}
        </div>
      )}
      {f.result && typeof f.result.parsedRows === "number" && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          검산 — 파싱 {f.result.parsedRows} = 반영 {f.result.appliedRows ?? 0} + 권한제외{" "}
          {f.result.outOfScope ?? 0} + 스코프제외 {f.result.excludedByScope ?? 0} + 중복{" "}
          {f.result.duplicates ?? 0} + 팀미확정제외 {f.result.excludedNoTeam ?? 0} + 거부{" "}
          {f.result.rejected} + 정책스킵 {f.result.skipped}
          {(f.result.unclassified ?? 0) > 0 ? ` + 미분류 ${f.result.unclassified}` : ""}
        </div>
      )}
      {f.result?.outOfScopeKeys && f.result.outOfScopeKeys.length > 0 && (
        <div className="mt-2 space-y-1 rounded border border-orange-400/50 bg-orange-500/5 p-2 text-[11px] text-orange-800">
          <div className="font-semibold">
            권한 범위 밖이라 반영되지 않은 행 {f.result.outOfScopeKeys.length}건
          </div>
          <div className="max-h-40 overflow-auto font-mono leading-5">
            {f.result.outOfScopeKeys.join(", ")}
          </div>
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
          <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[11px]">
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
                  "HDEC PIC",
                  "HDEC ENG",
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
                  <td className="px-1.5 py-1">{r.level === "main" ? "M" : "S"}</td>
                  <td className="px-1.5 py-1">{r.category ?? ""}</td>
                  <td className="px-1.5 py-1">{r.plot ?? ""}</td>
                  <td className="px-1.5 py-1">{r.task_name ?? ""}</td>
                  <td className="px-1.5 py-1">{r.risk ?? ""}</td>
                  <td className="px-1.5 py-1">{r.sub_task_desc ?? ""}</td>
                  <td className="px-1.5 py-1">{r.hdec_pic_name ?? ""}</td>
                  <td className="px-1.5 py-1">{r.hdec_eng_name ?? ""}</td>
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}