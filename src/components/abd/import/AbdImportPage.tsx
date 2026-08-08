import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutOfScopeRowsPopover } from "@/components/shared/OutOfScopeRowsPopover";
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
import { useAbdSourceGuard } from "@/hooks/useAbdSourceGuard";
import { AbdSourceGuardDialog } from "./AbdSourceGuardDialog";
import {
  emitAbdImportHandoff,
  subscribeAbdImportHandoff,
} from "@/lib/abd/import-handoff";
import { DateIssuesPanel } from "@/components/import/DateIssuesPanel";
import type { DateIssue } from "@/lib/import/date-audit";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Columns3 } from "lucide-react";
import { AbdAconexImportPage } from "./AbdAconexImportPage";
import { useAbdFieldConfig } from "@/hooks/useAbdFieldConfig";
import { AbdDataDatePicker } from "./AbdDataDatePicker";
import { parseDataDateFromFileName } from "@/lib/abd/filename-date";
import {
  ColumnSelectDialog,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";

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
    /** OCS 미완료로 행 단위 제외된 도면 목록 */
    ocsSkipped?: {
      abd_number: string;
      reason: string;
      round?: number | null;
      field_label?: string | null;
      pending_count?: number | null;
    }[];
    /** 비-OCS 오류로 반영되지 못한 행 */
    failedRows?: { abd_number: string; error: string }[];
  };
  progress?: number;
  /** 임포트 진행 상세 (현재 시트/청크/ETA) */
  progressInfo?: {
    sheetName: string | null;
    sheetIdx: number;   // 1-based
    sheetCount: number;
    chunkIdx: number;   // 1-based
    chunkTotal: number;
    etaSec: number | null;
  };
  allowDuplicates?: boolean;
  dateOverrides?: Record<string, string>;
  /** 이 파일에서 임포트 시 제외할 canonical field 목록 (기본 = 전체 포함). */
  excludedFields?: string[];
  /** 이 파일에 기록할 Data Date (YYYY-MM-DD). null/undefined = 오늘(Doha). */
  dataDate?: string | null;
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

function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "곧 완료";
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

/** OCS 준수 상태 — 시스템 산출 컬럼(임포트 대상 아님, 컬럼 메뉴 표시 전용) */
const OCS_DISPLAY_FIELD = "ocs_check";

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

  // 프리셋 목록 (HDEC 컬럼 선택 다이얼로그에 프리셋 버튼으로 노출)
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
  const hdecPresets = useMemo(
    () => presets.filter((p) => p.mode === "hdec"),
    [presets],
  );

  // HDEC 컬럼 선택 다이얼로그 상태
  const [columnFileId, setColumnFileId] = useState<string | null>(null);
  const columnFile = useMemo(
    () => entries.find((x) => x.id === columnFileId) ?? null,
    [entries, columnFileId],
  );
  const hdecFieldKeys = useMemo(
    () => [...hdecFieldOptions.map((o) => o.field), OCS_DISPLAY_FIELD],
    [hdecFieldOptions],
  );
  const hdecFieldLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of hdecFieldOptions) m.set(o.field, o.label);
    m.set(OCS_DISPLAY_FIELD, "OCS");
    return m;
  }, [hdecFieldOptions]);

  const columnSelectHelpers = useMemo<ColumnSelectHelpers>(() => {
    const knownSet = new Set(hdecFieldKeys);
    return {
      toFieldName: (h) => h,
      getRequirement: (header) => {
        if (header === "abd_number") {
          return {
            required: true,
            reason: "system",
            message: `⚠ "abd_number"은(는) ABD 임포트의 유니크 키입니다. 제외할 수 없습니다.`,
          };
        }
        return { required: false };
      },
      isKnownField: (field) => knownSet.has(field),
      getSourceLabel: (field) => (field === OCS_DISPLAY_FIELD ? "SYSTEM" : "HDEC"),
      getSourceOrigin: (field) => (field === OCS_DISPLAY_FIELD ? "system" : "hdec"),
      isDisplayOnly: (header) => header === OCS_DISPLAY_FIELD,
    };
  }, [hdecFieldKeys]);

  const columnSelectPresets = useMemo(
    () => [
      { id: "__all", label: "전체 선택", matchedHeaders: undefined },
      ...hdecPresets.map((p) => ({
        id: p.id,
        label: p.label,
        matchedHeaders: p.fields.filter((f) => hdecFieldKeys.includes(f)),
      })),
    ],
    [hdecPresets, hdecFieldKeys],
  );

  const setFileExcludedFields = (id: string, excluded: string[]) => {
    setEntries((prev) =>
      prev.map((x) => (x.id === id ? { ...x, excludedFields: excluded } : x)),
    );
    const label = hdecFieldLabelMap;
    if (excluded.length > 0) {
      toast.info(`컬럼 선택: 제외 ${excluded.length}개`);
    }
    void label;
  };

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

  const sourceGuard = useAbdSourceGuard({
    mode: "hdec",
    onAccepted: (fs) => {
      void handleFiles(fs);
    },
    onSwitchMode: (target, fs) => {
      setMode(target);
      emitAbdImportHandoff(target, fs);
      toast.info(
        `${target === "aconex" ? "Aconex" : "HDEC"} 모드로 전환하고 ${fs.length}개 파일을 넘겼습니다`,
      );
    },
  });
  const guard = useModuleGuard("abd", (fs) => {
    void sourceGuard.receive(fs);
  });
  // 다른 모드에서 넘어온 HDEC 파일 자동 수신 (지문 재검증 생략 — 소스 확정 상태)
  useEffect(() => {
    return subscribeAbdImportHandoff("hdec", (fs) => {
      void handleFiles(fs);
    });
    // handleFiles 는 useCallback([]) 이라 안정 참조
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      dataDate: parseDataDateFromFileName(f.name),
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
  const setDataDate = (id: string, v: string | null) =>
    setEntries((p) => p.map((x) => (x.id === id ? { ...x, dataDate: v } : x)));
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
        const agg = {
          inserted: 0,
          updated: 0,
          inactivated: 0,
          total: 0,
          ocsSkipped: [] as { abd_number: string; reason: string }[],
        };
        // 파일당 로그 1건 — 첫 호출에서 log_id를 발급받아 이후 호출은 append.
        let logId: string | null = null;
        const sheets = e.parsed.sheets;
        const fileTotal = sheets.reduce((s, sh) => s + sh.rows.length, 0);
        const finalizeScope = sheets.map((sh) => ({
          plot: sh.plot ?? null,
          abd_numbers: sh.rows.map((r) => r.abd_number),
        }));
        // CF Worker CPU 한도 초과 방지: 시트 rows를 작은 HTTP 청크로 잘라 호출.
        // log_id append 로 파일당 로그 1건 유지. finalize/finalize_scope 는 파일 최종 호출에서만 true.
        const HTTP_CHUNK = 100;
        const plan: Array<{ sheetIdx: number; start: number; end: number }> = [];
        sheets.forEach((sh, sIdx) => {
          const n = sh.rows.length;
          if (n === 0) {
            plan.push({ sheetIdx: sIdx, start: 0, end: 0 });
            return;
          }
          for (let s = 0; s < n; s += HTTP_CHUNK) {
            plan.push({ sheetIdx: sIdx, start: s, end: Math.min(s + HTTP_CHUNK, n) });
          }
        });
        const startedAt = Date.now();
        for (let idx = 0; idx < plan.length; idx++) {
          if (cancelRequestedRef.current) throw new Error("__CANCELLED__");
          const { sheetIdx, start, end } = plan[idx];
          const sheet = sheets[sheetIdx];
          const isLast = idx === plan.length - 1;
          // 시트별 청크 번호(1-based)와 시트 내 총 청크 수 계산
          const sameSheetChunks = plan.filter((p) => p.sheetIdx === sheetIdx);
          const chunkIdxInSheet =
            sameSheetChunks.findIndex((p) => p.start === start) + 1;
          setEntries((p) =>
            p.map((x) =>
              x.id === e.id
                ? {
                    ...x,
                    progressInfo: {
                      sheetName: sheet.sheet_name ?? sheet.plot ?? null,
                      sheetIdx: sheetIdx + 1,
                      sheetCount: sheets.length,
                      chunkIdx: chunkIdxInSheet,
                      chunkTotal: sameSheetChunks.length,
                      etaSec:
                        idx > 0
                          ? Math.max(
                              1,
                              Math.round(
                                ((Date.now() - startedAt) / idx) *
                                  (plan.length - idx) /
                                  1000,
                              ),
                            )
                          : null,
                    },
                  }
                : x,
            ),
          );
          const rows = sheet.rows
            .slice(start, end)
            .map((r) => ({ ...r, plot: r.plot ?? sheet.plot ?? null }));
          const res = await importAbdBatch({
            data: {
              file_name: e.file.name,
              team: e.team,
              plot: sheet.plot,
              sheet_name: sheet.sheet_name,
              data_date: e.dataDate || todayInDoha(),
              rows,
              inactivate_missing: true,
              allow_duplicates: !!e.allowDuplicates,
              note: formatUnresolvedNamesNote(unresolvedNames) || null,
              excluded_fields: e.excludedFields ?? [],
              log_id: logId,
              file_total_rows: fileTotal,
              finalize: isLast,
              finalize_scope: isLast ? finalizeScope : undefined,
            } as any,
          });
          if (!logId) logId = res.batch_id;
          agg.inserted += res.inserted;
          agg.updated += res.updated;
          agg.inactivated += res.inactivated;
          agg.total += res.total;
          for (const s of ((res as any).ocs_skipped_rows ?? []) as {
            abd_number: string;
            reason: string;
          }[]) {
            if (!agg.ocsSkipped.some((x) => x.abd_number === s.abd_number)) agg.ocsSkipped.push(s);
          }
          const pct = 10 + Math.round(((idx + 1) / plan.length) * 85);
          setEntries((p) =>
            p.map((x) => (x.id === e.id ? { ...x, progress: pct } : x)),
          );
        }
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id
              ? { ...x, status: "done", result: agg, progress: 100, progressInfo: undefined }
              : x,
          ),
        );
        toast.success(
          `${e.file.name}: ${agg.inserted} 신규 / ${agg.updated} 변경 / ${agg.inactivated} 비활성` +
            (agg.ocsSkipped.length > 0 ? ` / OCS 미완료 제외 ${agg.ocsSkipped.length}행` : ""),
        );
      } catch (err: any) {
        const rawMsg = err?.message ?? String(err);
        const msg = /internal server error|worker exceeded cpu|cpu time|\b502\b/i.test(rawMsg)
          ? "서버 처리 시간이 초과되었습니다. 임포트 청크를 줄여 다시 처리하도록 수정 중입니다. 잠시 후 다시 시도하세요."
          : rawMsg;
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

      {mode === "aconex" && <AbdAconexImportPage />}

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
                onOpenColumnSelect={() => setColumnFileId(e.id)}
                onDataDateChange={(v) => setDataDate(e.id, v)}
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
      <AbdSourceGuardDialog {...sourceGuard.dialogProps} />
        </>
      )}
      {columnFile && (
        <ColumnSelectDialog
          open={!!columnFile}
          onOpenChange={(o) => {
            if (!o) setColumnFileId(null);
          }}
          fileName={columnFile.file.name}
          headers={hdecFieldKeys}
          samples={{}}
          defaultExcluded={columnFile.excludedFields ?? []}
          onApply={(excluded) => setFileExcludedFields(columnFile.id, excluded)}
          helpers={columnSelectHelpers}
          presets={columnSelectPresets}
          lockRequired
        />
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
  onOpenColumnSelect,
  onDataDateChange,
}: {
  entry: FileEntry;
  isRunning: boolean;
  onRemove: () => void;
  onTeamChange: (t: string) => void;
  onOpenDuplicates: () => void;
  onDateOverridesApply: (overrides: Record<string, string>) => void | Promise<void>;
  onOpenColumnSelect: () => void;
  onDataDateChange: (v: string | null) => void;
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
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={onOpenColumnSelect}
                disabled={disabled}
              >
                <Columns3 className="h-3.5 w-3.5" /> 컬럼 선택
                {e.excludedFields && e.excludedFields.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (제외 {e.excludedFields.length})
                  </span>
                )}
              </Button>
              <AbdDataDatePicker
                value={e.dataDate ?? null}
                onChange={onDataDateChange}
                fileDate={parseDataDateFromFileName(e.file.name)}
                disabled={disabled}
              />
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
        <div className="mt-2 space-y-1">
          <Progress value={e.progress ?? 40} className="h-1.5" />
          {e.progressInfo && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                시트 {e.progressInfo.sheetIdx}/{e.progressInfo.sheetCount}
                {e.progressInfo.sheetName ? ` · ${e.progressInfo.sheetName}` : ""}
                {" · "}청크 {e.progressInfo.chunkIdx}/{e.progressInfo.chunkTotal}
              </span>
              <span>
                {e.progressInfo.etaSec != null
                  ? `남은 예상 ${formatEta(e.progressInfo.etaSec)}`
                  : "남은 예상 계산 중…"}
              </span>
            </div>
          )}
        </div>
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
          {(e.result.ocsSkipped?.length ?? 0) > 0 && (
            <>
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                OCS 미완료 제외: {e.result.ocsSkipped!.length}행
              </Badge>
              <OutOfScopeRowsPopover
                rows={e.result.ocsSkipped!.map((s) => ({
                  abd_number: s.abd_number,
                  id: s.abd_number,
                }))}
                labelKeys={["abd_number"]}
                title="OCS 미완료 제외 목록"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}