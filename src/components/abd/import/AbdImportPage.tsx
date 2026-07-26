import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";
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
import { useModuleGuard } from "@/hooks/useModuleGuard";
import { ModuleGuardDialog } from "@/components/import/ModuleGuardDialog";
import { DateIssuesPanel } from "@/components/import/DateIssuesPanel";
import type { DateIssue } from "@/lib/import/date-audit";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RefreshCw } from "lucide-react";
import { AbdAconexImportPage } from "./AbdAconexImportPage";
import { useAbdFieldConfig } from "@/hooks/useAbdFieldConfig";
import { ABD_ACONEX_SYNC_FIELDS } from "@/components/admin/AbdImportPresetTable";

type AconexSyncKey =
  | "latest_status"
  | "latest_rev"
  | "approval_date"
  | "aconex_status_raw"
  | "aconex_review_status_raw"
  | "aconex_date_modified";

type ImportMode = "hdec" | "aconex";

interface PresetRow {
  id: string;
  mode: ImportMode;
  label: string;
  fields: string[];
  sort_order: number;
}

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
  dateOverrides?: Record<string, string>;
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
  const [mode, setMode] = useState<ImportMode>("hdec");
  const [busy, setBusy] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // 활성 ABD field_config 필드 목록 (HDEC 모드용)
  const { data: fieldConfig = [] } = useAbdFieldConfig();
  const hdecFieldOptions = useMemo(
    () =>
      fieldConfig
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((r) => ({ field: r.field_key, label: r.label || r.field_key })),
    [fieldConfig],
  );
  const aconexFieldOptions = useMemo(
    () => ABD_ACONEX_SYNC_FIELDS.map((o) => ({ field: o.field, label: o.label })),
    [],
  );
  const fieldOptions = mode === "hdec" ? hdecFieldOptions : aconexFieldOptions;

  // 대상 필드 선택: 체크된 필드 집합 (기본 = 전체 선택)
  const [hdecSelected, setHdecSelected] = useState<Set<string> | null>(null);
  const [aconexSelected, setAconexSelected] = useState<Set<string>>(
    () => new Set(ABD_ACONEX_SYNC_FIELDS.map((o) => o.field)),
  );
  // HDEC 옵션이 로드되면 기본 = 전체 선택으로 초기화
  const effectiveHdecSelected = useMemo(() => {
    if (hdecSelected) return hdecSelected;
    return new Set(hdecFieldOptions.map((o) => o.field));
  }, [hdecSelected, hdecFieldOptions]);
  const selectedSet = mode === "hdec" ? effectiveHdecSelected : aconexSelected;
  const setSelected = (next: Set<string>) => {
    if (mode === "hdec") setHdecSelected(new Set(next));
    else setAconexSelected(new Set(next));
  };

  // 프리셋 목록
  const { data: presets = [] } = useQuery({
    queryKey: ["abd-import-presets", "all"],
    queryFn: async (): Promise<PresetRow[]> => {
      const { data, error } = await (supabase as any)
        .from("abd_import_presets")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PresetRow[];
    },
    staleTime: 10_000,
  });
  const modePresets = presets.filter((p) => p.mode === mode);

  const applyPreset = (p: PresetRow) => {
    setSelected(new Set(p.fields));
    toast.success(`프리셋 적용: ${p.label} (${p.fields.length}개 필드)`);
  };
  const selectAllFields = () => setSelected(new Set(fieldOptions.map((o) => o.field)));
  const clearAllFields = () => setSelected(new Set());

  // Aconex 서버함수용 apply_fields (Aconex 6개 중 선택된 것)
  const syncFields = useMemo(
    () => Array.from(aconexSelected) as AconexSyncKey[],
    [aconexSelected],
  );
  // HDEC 서버함수용 excluded_fields (전체 - 선택)
  const hdecExcludedFields = useMemo(() => {
    const all = new Set(hdecFieldOptions.map((o) => o.field));
    return Array.from(all).filter((f) => !effectiveHdecSelected.has(f));
  }, [hdecFieldOptions, effectiveHdecSelected]);

  const cancelRequestedRef = useRef(false);
  const requestCancel = () => {
    if (!cancelRequestedRef.current) {
      cancelRequestedRef.current = true;
      setIsCancelling(true);
      toast.warning("취소 요청됨. 현재 시트 완료 후 중단됩니다.");
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const [dupOpenId, setDupOpenId] = useState<string | null>(null);
  const { data: teamOptions = [] } = useTeamOptions();
  const currentUserQ = useCurrentUser();
  const canRegisterTeam = !!(currentUserQ.data?.isAdmin || currentUserQ.data?.isSuperUser);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const masterOptions = useAllMasterOptions();

  const guard = useModuleGuard("abd", (fs) => {
    void handleFiles(fs);
  });

  const nameSpecs: NameFieldSpec<ParsedAbdRow>[] = [
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
        if (parsed.dateIssues.length > 0) {
          toast.warning(
            `${e.file.name}: 날짜 형식 오류 ${parsed.dateIssues.length}건 — 아래 목록에서 수정 후 재파싱하세요.`,
          );
        }
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

  const reparseWithOverrides = useCallback(
    async (id: string, overrides: Record<string, string>) => {
      const target = entries.find((x) => x.id === id);
      if (!target) return;
      setEntries((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, status: "parsing", dateOverrides: overrides } : x,
        ),
      );
      try {
        const parsed = await parseAbdFile(
          target.file,
          target.team ?? undefined,
          teamOptions,
          { dateOverrides: overrides },
        );
        setEntries((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  parsed,
                  team: parsed.team_from_filename ?? x.team,
                  status: "ready",
                  dateOverrides: overrides,
                }
              : x,
          ),
        );
        if (parsed.dateIssues.length === 0) {
          toast.success(`${target.file.name}: 날짜 오류 모두 해결됨`);
        } else {
          toast.warning(
            `${target.file.name}: 아직 ${parsed.dateIssues.length}건의 날짜 오류가 남아 있습니다.`,
          );
        }
      } catch (err: any) {
        setEntries((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: "error", error: err?.message ?? String(err) }
              : x,
          ),
        );
      }
    },
    [entries, teamOptions],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void guard.receive(Array.from(e.dataTransfer.files));
    },
    [],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void guard.receive(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [],
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
    ((e.parsed?.duplicates_in_file.length ?? 0) === 0 || !!e.allowDuplicates) &&
    (e.parsed?.dateIssues.length ?? 0) === 0;
  const readyCount = entries.filter(isReady).length;
  const isRunning = busy;

  const startImport = async () => {
    setBusy(true);
    cancelRequestedRef.current = false;
    setIsCancelling(false);
    try {
      await takePreImportSnapshotWithFeedback("abd");
    } catch {
      // toast 메시지는 takePreImportSnapshotWithFeedback 내부에서 처리
    }
    for (const e of entries) {
      if (!isReady(e) || !e.parsed || !e.team) continue;
      if (cancelRequestedRef.current) {
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id
              ? { ...x, status: "error", error: "사용자 취소 — 대기 중" }
              : x,
          ),
        );
        continue;
      }
      setEntries((p) =>
        p.map((x) => (x.id === e.id ? { ...x, status: "importing", progress: 20 } : x)),
      );
      try {
        const agg = { inserted: 0, updated: 0, inactivated: 0, total: 0 };
        for (const sheet of e.parsed.sheets) {
          if (cancelRequestedRef.current) {
            throw new Error("__CANCELLED__");
          }
          const rows = sheet.rows.map((r) => ({ ...r, plot: r.plot ?? sheet.plot ?? null }));
          const res = await importAbdBatch({
            data: {
              file_name: e.file.name,
              team: e.team,
              plot: sheet.plot,
              sheet_name: sheet.sheet_name,
              data_date: todayInDoha(),
              rows,
              inactivate_missing: true,
              allow_duplicates: !!e.allowDuplicates,
              note: formatUnresolvedNamesNote(unresolvedNames) || null,
              excluded_fields: hdecExcludedFields,
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
        const msg = err?.message ?? String(err);
        const cancelled = msg === "__CANCELLED__";
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id
              ? { ...x, status: "error", error: cancelled ? "사용자 취소" : msg }
              : x,
          ),
        );
        if (!cancelled) toast.error(`${e.file.name} 임포트 실패: ${msg}`);
      }
    }
    setBusy(false);
    if (cancelRequestedRef.current) toast.info("ABD import 취소됨");
    cancelRequestedRef.current = false;
    setIsCancelling(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">ABD — Import</h1>
          <p className="text-sm text-muted-foreground">
            토글로 소스를 선택하세요 · <b>Import HDEC</b>: 원본 엑셀(다단 헤더) 업로드/upsert · <b>Import Aconex</b>: Aconex Docs 시트로 <b>기존 항목만 UPDATE</b>.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/30">
          <div className={`flex items-center gap-1.5 text-sm ${mode === "hdec" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <FileSpreadsheet className="h-4 w-4" /> Import HDEC
          </div>
          <Switch
            checked={mode === "aconex"}
            onCheckedChange={(v) => setMode(v ? "aconex" : "hdec")}
            aria-label="Import 모드 전환"
          />
          <div className={`flex items-center gap-1.5 text-sm ${mode === "aconex" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <RefreshCw className="h-4 w-4" /> Import Aconex
          </div>
        </div>
      </div>

      {/* 공용: 대상 필드 선택 카드 + 프리셋 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base">
                {mode === "hdec" ? "Import 대상 필드 선택 (HDEC)" : "Sync 대상 필드 선택 (Aconex)"}
              </CardTitle>
              <CardDescription>
                {mode === "hdec"
                  ? "체크된 필드만 이번 임포트에서 반영됩니다. 체크 해제된 필드는 파일에 값이 있어도 기존 DB 값이 유지됩니다."
                  : "이번 업로드에서 실제로 UPDATE 할 컬럼만 체크하세요."}
                (기본: 전체)
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted-foreground mr-1">프리셋:</span>
              {modePresets.length === 0 && (
                <span className="text-[11px] text-muted-foreground italic">등록된 프리셋 없음</span>
              )}
              {modePresets.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-auto">
            {fieldOptions.map((opt) => {
              const checked = selectedSet.has(opt.field);
              return (
                <label
                  key={opt.field}
                  className={`flex items-start gap-2 rounded border p-2 cursor-pointer transition ${
                    checked ? "border-primary/60 bg-primary/5" : "hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      const next = new Set(selectedSet);
                      if (v) next.add(opt.field);
                      else next.delete(opt.field);
                      setSelected(next);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{opt.field}</div>
                  </div>
                </label>
              );
            })}
            {fieldOptions.length === 0 && (
              <div className="col-span-full px-2 py-4 text-center text-xs text-muted-foreground">
                필드 옵션을 불러오는 중…
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <button
              type="button"
              className="rounded border px-2 py-0.5 hover:bg-muted"
              onClick={selectAllFields}
            >전체 선택</button>
            <button
              type="button"
              className="rounded border px-2 py-0.5 hover:bg-muted"
              onClick={clearAllFields}
            >전체 해제</button>
            <span>선택 {selectedSet.size} / {fieldOptions.length}</span>
            {mode === "aconex" && aconexSelected.size === 0 && (
              <span className="text-destructive">최소 1개 이상 선택해야 Sync 가 실행됩니다.</span>
            )}
          </div>
        </CardContent>
      </Card>

      {mode === "aconex" && (
        <>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Aconex Sync 규칙</AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              <div>· Aconex Docs 시트를 업로드 → <code>Document No = ABD_NUMBER</code> 기준으로 매칭합니다.</div>
              <div>· DB에 없는 Document No는 <b>자동 INSERT 되지 않고</b> 미매칭 목록으로 리포트됩니다.</div>
              <div>· 위에서 체크한 컬럼만 실제 UPDATE 됩니다. 라운드 계획/실적은 절대 덮어쓰지 않습니다.</div>
              <div>· Approval Date는 <code>Status=A</code> 이고 Date Modified가 있을 때만 갱신됩니다.</div>
            </AlertDescription>
          </Alert>
          <AbdAconexImportPage syncFields={syncFields} hideHeader />
        </>
      )}

      {mode === "hdec" && (
        <>
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
                onDateOverridesApply={(ovr) => reparseWithOverrides(e.id, ovr)}
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
      <ModuleGuardDialog {...guard.dialogProps} />
        </>
      )}
    </div>
  );
}

function FileRow({
  entry: e,
  isRunning,
  onRemove,
  onTeamChange,
  onOpenDuplicates,
  onDateOverridesApply,
}: {
  entry: FileEntry;
  isRunning: boolean;
  onRemove: () => void;
  onTeamChange: (t: string) => void;
  onOpenDuplicates: () => void;
  onDateOverridesApply: (overrides: Record<string, string>) => void | Promise<void>;
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
            {e.parsed && e.parsed.dateIssues.length > 0 && (
              <div className="mt-2">
                <DateIssuesPanel
                  fileName={e.file.name}
                  sheetName={null}
                  issues={e.parsed.dateIssues}
                  currentOverrides={e.dateOverrides}
                  onApply={onDateOverridesApply}
                  disabled={isRunning || e.status === "importing"}
                />
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