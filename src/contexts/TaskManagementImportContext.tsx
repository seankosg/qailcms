import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  parseTaskManagementExcel,
  getTaskExcelSheetNames,
  getTaskExcelHeaders,
  type ParsedTaskRow,
  type SheetHeaderEntry,
} from "@/lib/task-management/parser";
import type { Discipline } from "@/lib/task-management/columns";
import { runRollupAllMains, runRecalcAutoJudgment } from "@/lib/task-management/rollup.functions";
import { stripNullExcept } from "@/lib/import/strip-null";
import { buildFieldLog, classifyChange, flushFieldLogs, type PendingFieldLog } from "@/lib/import/field-log";
import {
  previewTaskImport,
  allocateTaskNo,
  type PreflightSummary,
} from "@/lib/task-management/import-preflight.functions";
import { takePreImportSnapshotWithFeedback } from "@/lib/backup/pre-import-snapshot";
import { rclImportFilter, rclKeyOf } from "@/lib/import/rcl-import-filter";

export type RollupMode = "auto" | "keep" | "blank";

export type ConflictPolicy = "overwrite" | "skip" | "renumber";

export type ImportScope = "mine" | "all";

export interface ImportErrorEntry {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  batch: number;
  sampleTaskNo?: string;
}

export type TmFileStatus =
  | "pending"
  | "parsing"
  | "pending_sheet_selection"
  | "ready"
  | "processing"
  | "done"
  | "failed";

export interface TmImportFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: TmFileStatus;
  progress: number;
  parsed?: ParsedTaskRow[];
  dataDate?: string | null;
  dataDateCell?: string | null;
  dataDateOverride?: string | null;
  parentCount?: number;
  childCount?: number;
  warnings?: string[];
  sheetName?: string;
  sheetNames?: string[];
  discipline?: Discipline | null;
  disciplineHint?: Discipline | null;
  validationError?: string | null;
  error?: string;
  sheetHeaders?: SheetHeaderEntry[];
  columnMap?: Record<string, number>;
  availableHeaders?: string[];
  headerSamples?: Record<string, unknown>;
  headerToFieldMap?: Record<string, string>;
  excludedHeaders?: string[];
  dateIssues?: import("@/lib/import/date-audit").DateIssue[];
  /** A. 헤더 미탐지로 임포트에서 제외된 필드 */
  unmappedFields?: string[];
  /** B. 값 형태 불일치로 강등된 필드 */
  demotedFields?: import("@/lib/task-management/parser").DemotedField[];
  /** C. 사용자가 "이 컬럼들 없이 진행"을 명시적으로 승인했는가 */
  ackUnmapped?: boolean;
  dateOverrides?: Record<string, string>;
  conflictPolicy?: ConflictPolicy;
  conflictDecisions?: Record<string, ConflictPolicy>;
  preflight?: PreflightSummary | null;
  preflightLoading?: boolean;
  preflightError?: string | null;
  masterMappingNote?: string;
  result?: {
    inserted: number;
    updated: number;
    skipped: number;
    rejected: number;
    duplicates?: number;
    rolledUp?: number;
    judgmentRecalculated?: number;
    renumbered?: number;
    resolvedByDecision?: number;
    /** RCL 범위 밖이라 서버 판정에서 제외된 행 수 */
    outOfScope?: number;
    /** 제외된 행의 task_no 목록 (조용한 누락 방지) */
    outOfScopeKeys?: string[];
    /** 파싱된 전체 행수(분모) */
    parsedRows?: number;
    /** 실제 반영 대상 행수 */
    appliedRows?: number;
    /** mine 토글로 제외된 행수 (권한 제외와 분리) */
    excludedByScope?: number;
    /** 항등식이 맞지 않을 때의 잔차 */
    unclassified?: number;
    errors?: ImportErrorEntry[];
  };
}

interface CtxValue {
  files: TmImportFileItem[];
  getFiles: () => TmImportFileItem[];
  isRunning: boolean;
  isCancelling: boolean;
  requestCancel: () => void;
  rollupMode: RollupMode;
  setRollupMode: (m: RollupMode) => void;
  recalcJudgment: boolean;
  setRecalcJudgment: (v: boolean) => void;
  importScope: ImportScope;
  setImportScope: (s: ImportScope) => void;
  importerHdecPicName: string | null;
  setImporterHdecPicName: (v: string | null) => void;
  /** 서버 Own 정의(owner_cols = hdec_pic_name | hdec_eng_name)와 동일하게 맞추기 위한 본인 표기 목록 */
  importerOwnNames: string[];
  setImporterOwnNames: (v: string[]) => void;
  isImporterAdmin: boolean;
  setIsImporterAdmin: (v: boolean) => void;
  matchesHdecPic: (row: {
    hdec_pic_name?: string | null;
    hdec_eng_name?: string | null;
  }) => boolean;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  setFileDiscipline: (id: string, d: Discipline | null) => void;
  setFileDataDateOverride: (id: string, date: string | null) => void;
  setFileSheet: (id: string, sheetName: string) => Promise<void>;
  setFileExcludedHeaders: (id: string, excluded: string[]) => Promise<void>;
  setFileDateOverrides: (id: string, overrides: Record<string, string>) => Promise<void>;
  setFileConflictPolicy: (id: string, policy: ConflictPolicy) => void;
  setFileAckUnmapped: (id: string, ack: boolean) => void;
  setFileConflictDecisions: (id: string, decisions: Record<string, ConflictPolicy>) => void;
  clearFileConflictDecisions: (id: string) => void;
  runPreflight: (id: string) => Promise<void>;
  startImport: () => Promise<void>;
  setFileParsedRows: (id: string, next: ParsedTaskRow[]) => void;
  setFileMasterMappingNote: (id: string, note: string) => void;
}

const Ctx = createContext<CtxValue | null>(null);

export function useTaskManagementImport() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTaskManagementImport must be used within provider");
  return c;
}

const INSERT_CHUNK = 500;

export function TaskManagementImportProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<TmImportFileItem[]>([]);
  const filesRef = useRef<TmImportFileItem[]>(files);
  filesRef.current = files;
  const getFiles = useCallback(() => filesRef.current, []);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelRequestedRef = useRef(false);
  const requestCancel = useCallback(() => {
    if (!cancelRequestedRef.current) {
      cancelRequestedRef.current = true;
      setIsCancelling(true);
      toast.warning("취소 요청됨. 현재 배치 완료 후 중단됩니다.");
    }
  }, []);
  const [rollupMode, setRollupMode] = useState<RollupMode>("auto");
  const [recalcJudgment, setRecalcJudgment] = useState<boolean>(true);
  const [importScope, setImportScope] = useState<ImportScope>("mine");
  const [importerHdecPicName, setImporterHdecPicName] = useState<string | null>(null);
  const [importerOwnNames, setImporterOwnNames] = useState<string[]>([]);
  const [isImporterAdmin, setIsImporterAdmin] = useState<boolean>(false);

  const importerHdecPicRef = useRef<string | null>(null);
  importerHdecPicRef.current = importerHdecPicName;
  const importerOwnNamesRef = useRef<string[]>([]);
  importerOwnNamesRef.current = importerOwnNames;
  const importScopeRef = useRef<ImportScope>(importScope);
  importScopeRef.current = importScope;
  const isImporterAdminRef = useRef<boolean>(isImporterAdmin);
  isImporterAdminRef.current = isImporterAdmin;

  const normalizePic = (v?: string | null) => (v ?? "").trim().toLowerCase();
  /**
   * 서버 Own 판정(public.rcl_scope_of_values)은 owner_cols = [hdec_pic_name, hdec_eng_name] 를
   * resolve_user_by_name 으로 대조한다. 클라이언트 mine 토글도 동일 기준을 쓴다.
   * (PIC 전용으로 두면 ENG 담당자는 mine 선택 시 자기 행이 전부 빠진다)
   */
  const ownNameSet = () => {
    const s = new Set<string>();
    for (const n of importerOwnNamesRef.current) {
      const k = normalizePic(n);
      if (k) s.add(k);
    }
    const legacy = normalizePic(importerHdecPicRef.current);
    if (legacy) s.add(legacy);
    return s;
  };
  const matchesHdecPic = useCallback(
    (row: { hdec_pic_name?: string | null; hdec_eng_name?: string | null }) => {
      const effective = isImporterAdminRef.current ? "all" : importScopeRef.current;
      if (effective === "all") return true;
      const mine = ownNameSet();
      if (mine.size === 0) return false;
      return mine.has(normalizePic(row.hdec_pic_name)) || mine.has(normalizePic(row.hdec_eng_name));
    },
    [],
  );

  const fetchAliases = useCallback(async (): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    try {
      const { data: mappings } = await (supabase as any)
        .from("task_management_header_mappings")
        .select("source_header, target_field, is_active")
        .eq("module", "task_management")
        .eq("is_active", true);
      for (const m of (mappings ?? []) as Array<{ source_header: string; target_field: string }>) {
        if (!m.target_field || !m.source_header) continue;
        (out[m.target_field] ||= []).push(m.source_header);
      }
    } catch {
      // ignore
    }
    return out;
  }, []);

  const fetchAllowedMilestoneCodes = useCallback(async (): Promise<string[]> => {
    try {
      const { data } = await (supabase as any)
        .from("tm_milestone_kinds")
        .select("kind_code")
        .is("deleted_at", null);
      const codes = (data ?? [])
        .map((r: { kind_code: string }) => r.kind_code)
        .filter(Boolean);
      // fallback: 목록이 비어있으면 기본 3종
      return codes.length > 0 ? codes : ["HO", "COC", "DLP"];
    } catch {
      return ["HO", "COC", "DLP"];
    }
  }, []);

  const parseAndApply = useCallback(
    async (
      id: string,
      file: File,
      sheetName?: string,
      excludedHeaders?: string[],
    ) => {
      const extraAliases = await fetchAliases();
      const allowedMilestoneCodes = await fetchAllowedMilestoneCodes();
      let currentOverride: string | null = null;
      let currentDateOverrides: Record<string, string> = {};
      setFiles((cur) => {
        const t = cur.find((f) => f.id === id);
        currentOverride = t?.dataDateOverride ?? null;
        currentDateOverrides = t?.dateOverrides ?? {};
        return cur.map((f) =>
          f.id === id ? { ...f, status: "parsing" } : f,
        );
      });
      try {
        const parsed = await parseTaskManagementExcel(file, {
          extraAliases,
          sheetName,
          excludedHeaders,
          dataDateOverride: currentOverride,
          dateOverrides: currentDateOverrides,
          allowedMilestoneCodes,
        });
        setFiles((cur) =>
          cur.map((f) => {
            if (f.id !== id) return f;
            const effective = f.dataDateOverride ?? parsed.dataDate ?? null;
            const hasDateIssues = (parsed.dateIssues?.length ?? 0) > 0;
            const validation =
              parsed.rows.length === 0
                ? "행을 찾지 못했습니다. 헤더 위치를 확인하세요."
                : !effective
                  ? "Data Date를 읽지 못했습니다. 아래에서 직접 입력하세요."
                  : hasDateIssues
                    ? `날짜 형식 오류 ${parsed.dateIssues.length}건이 있습니다. 아래 목록에서 수정 후 재파싱하세요.`
                    : null;
            return {
              ...f,
              status: "ready",
              parsed: parsed.rows,
              dataDate: parsed.dataDate,
              dataDateCell: parsed.dataDateCell,
              parentCount: parsed.parentCount,
              childCount: parsed.childCount,
              warnings: parsed.warnings,
              sheetName: parsed.sheetName,
              disciplineHint: parsed.disciplineHint,
              sheetHeaders: parsed.sheetHeaders,
              columnMap: parsed.columnMap,
              availableHeaders: parsed.availableHeaders,
              headerSamples: parsed.headerSamples,
              headerToFieldMap: parsed.headerToFieldMap,
              excludedHeaders: parsed.excludedHeaders,
              dateIssues: parsed.dateIssues,
              unmappedFields: parsed.unmappedFields ?? [],
              demotedFields: parsed.demotedFields ?? [],
              ackUnmapped: false,
              // preflight 재실행 필요 — 결과 초기화
              preflight: null,
              preflightError: null,
              validationError: validation,
            };
          }),
        );
      } catch (e) {
        setFiles((cur) =>
          cur.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Parse failed",
                }
              : f,
          ),
        );
      }
    },
    [fetchAliases, fetchAllowedMilestoneCodes],
  );

  const addFiles = useCallback(async (selected: File[]) => {
    const excel = selected.filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    const next: TmImportFileItem[] = excel.map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      name: file.name,
      size: file.size,
      status: "parsing",
      progress: 0,
      discipline: null,
    }));
    setFiles((cur) => [...cur, ...next]);

    for (const item of next) {
      try {
        const sheetNames = await getTaskExcelSheetNames(item.file);
        setFiles((cur) =>
          cur.map((f) => (f.id === item.id ? { ...f, sheetNames } : f)),
        );
        if (sheetNames.length > 1) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id ? { ...f, status: "pending_sheet_selection" } : f,
            ),
          );
          continue;
        }
        // 헤더 프리뷰 캡처
        const headerInfo = await getTaskExcelHeaders(item.file);
        if (headerInfo) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    availableHeaders: headerInfo.headers,
                    headerSamples: headerInfo.sample,
                    excludedHeaders: [],
                    sheetName: headerInfo.sheetName,
                  }
                : f,
            ),
          );
        }
        await parseAndApply(item.id, item.file);
      } catch (e) {
        setFiles((cur) =>
          cur.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Parse failed",
                }
              : f,
          ),
        );
      }
    }
  }, [parseAndApply]);

  const removeFile = useCallback(
    (id: string) => setFiles((cur) => cur.filter((f) => f.id !== id)),
    [],
  );
  const clearAll = useCallback(() => setFiles([]), []);

  const setFileParsedRows = useCallback(
    (id: string, next: ParsedTaskRow[]) => {
      setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, parsed: next } : f)));
    },
    [],
  );

  const setFileMasterMappingNote = useCallback(
    (id: string, note: string) => {
      setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, masterMappingNote: note } : f)));
    },
    [],
  );

  const setFileDiscipline = useCallback((id: string, d: Discipline | null) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, discipline: d } : f)));
  }, []);

  const setFileDataDateOverride = useCallback((id: string, date: string | null) => {
    setFiles((cur) =>
      cur.map((f) => {
        if (f.id !== id) return f;
        const effective = date ?? f.dataDate ?? null;
        const validation =
          !f.parsed || f.parsed.length === 0
            ? f.validationError
            : !effective
              ? "Data Date를 입력하세요."
              : null;
        return { ...f, dataDateOverride: date, validationError: validation };
      }),
    );
  }, []);

  const setFileSheet = useCallback(
    async (id: string, sheetName: string) => {
      let target: TmImportFileItem | undefined;
      setFiles((cur) => {
        target = cur.find((f) => f.id === id);
        return cur.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "parsing",
                sheetName,
                excludedHeaders: [],
                availableHeaders: undefined,
                headerSamples: undefined,
              }
            : f,
        );
      });
      if (!target) return;
      try {
        const headerInfo = await getTaskExcelHeaders(target.file, sheetName);
        if (headerInfo) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === id
                ? {
                    ...f,
                    availableHeaders: headerInfo.headers,
                    headerSamples: headerInfo.sample,
                  }
                : f,
            ),
          );
        }
        await parseAndApply(id, target.file, sheetName);
      } catch (e) {
        setFiles((cur) =>
          cur.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: "failed",
                  error: e instanceof Error ? e.message : "Sheet parse failed",
                }
              : f,
          ),
        );
      }
    },
    [parseAndApply],
  );

  const setFileExcludedHeaders = useCallback(
    async (id: string, excluded: string[]) => {
      let target: TmImportFileItem | undefined;
      setFiles((cur) => {
        target = cur.find((f) => f.id === id);
        return cur.map((f) =>
          f.id === id ? { ...f, status: "parsing", excludedHeaders: excluded } : f,
        );
      });
      if (!target) return;
      await parseAndApply(id, target.file, target.sheetName, excluded);
    },
    [parseAndApply],
  );

  const setFileDateOverrides = useCallback(
    async (id: string, overrides: Record<string, string>) => {
      let target: TmImportFileItem | undefined;
      setFiles((cur) => {
        target = cur.find((f) => f.id === id);
        return cur.map((f) =>
          f.id === id ? { ...f, status: "parsing", dateOverrides: overrides } : f,
        );
      });
      if (!target) return;
      await parseAndApply(id, target.file, target.sheetName, target.excludedHeaders);
    },
    [parseAndApply],
  );

  const setFileConflictPolicy = useCallback((id: string, policy: ConflictPolicy) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, conflictPolicy: policy } : f)));
  }, []);

  const setFileAckUnmapped = useCallback((id: string, ack: boolean) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, ackUnmapped: ack } : f)));
  }, []);

  const setFileConflictDecisions = useCallback(
    (id: string, decisions: Record<string, ConflictPolicy>) => {
      setFiles((cur) =>
        cur.map((f) => (f.id === id ? { ...f, conflictDecisions: decisions } : f)),
      );
    },
    [],
  );

  const clearFileConflictDecisions = useCallback((id: string) => {
    setFiles((cur) =>
      cur.map((f) => {
        if (f.id !== id) return f;
        const { conflictDecisions: _unused, ...rest } = f;
        void _unused;
        return rest;
      }),
    );
  }, []);

  const runPreflight = useCallback(async (id: string) => {
    let target: TmImportFileItem | undefined;
    setFiles((cur) => {
      target = cur.find((f) => f.id === id);
      return cur.map((f) =>
        f.id === id ? { ...f, preflightLoading: true, preflightError: null } : f,
      );
    });
    if (!target || !target.parsed || target.parsed.length === 0) {
      setFiles((cur) =>
        cur.map((f) =>
          f.id === id
            ? { ...f, preflightLoading: false, preflightError: "파싱된 행이 없습니다" }
            : f,
        ),
      );
      return;
    }
    try {
      const discipline = target.discipline ?? "ARCH";
      const rows = target.parsed.map((p) => ({
        task_no: p.task_no,
        main_task_no: p.main_task_no,
        level: p.level,
        task_name: p.task_name,
        plot: p.plot,
        category: p.category,
        plan_start: p.plan_start,
        plan_end: p.plan_end,
        actual_progress: p.actual_progress,
        actual_finish: p.actual_finish,
        actual_finish_cleared: p.actual_finish_cleared,
      }));
      const res = await previewTaskImport({ data: { discipline, rows } });
      setFiles((cur) =>
        cur.map((f) =>
          f.id === id
            ? { ...f, preflight: res, preflightLoading: false, preflightError: null }
            : f,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFiles((cur) =>
        cur.map((f) =>
          f.id === id ? { ...f, preflightLoading: false, preflightError: msg } : f,
        ),
      );
    }
  }, []);

  const executeImport = useCallback(async (ready: TmImportFileItem[]) => {
    setIsRunning(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    for (const f of ready) {
      if (cancelRequestedRef.current) {
        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? { ...x, status: "failed", error: "사용자 취소 — 대기 중 파일" }
              : x,
          ),
        );
        continue;
      }
      const parsedAll = f.parsed ?? [];
      const effectiveScope: ImportScope = isImporterAdminRef.current
        ? "all"
        : importScopeRef.current;
      const mineNames = ownNameSet();
      const mineLabel = Array.from(
        new Set(
          [...importerOwnNamesRef.current, importerHdecPicRef.current].filter(
            (v): v is string => !!v && v.trim() !== "",
          ),
        ),
      ).join(", ");
      const discipline = f.discipline ?? "ARCH";

      // ── RCL 서버 판정 (정본) ────────────────────────────────────────────
      // 스코프 판정은 클라이언트가 하지 않는다. 서버 rcl_can(..., 'import') 결과만 신뢰.
      const MATCH_COLS = ["discipline", "task_no"];
      let serverAllowed: typeof parsedAll = [];
      let outOfScopeKeys: string[] = [];
      let deniedEntries: { task_no: string; scope: string }[] = [];
      try {
        const rcl = await rclImportFilter(
          "TM",
          MATCH_COLS,
          parsedAll.map((p) => ({
            discipline,
            task_no: p.task_no,
            team: (p as any).team ?? null,
            hdec_pic_name: p.hdec_pic_name ?? null,
            hdec_eng_name: (p as any).hdec_eng_name ?? null,
          })),
        );
        serverAllowed = parsedAll.filter((p) =>
          rcl.allowedKeys.has(rclKeyOf(MATCH_COLS, { discipline, task_no: p.task_no })),
        );
        outOfScopeKeys = rcl.denied.map(
          (d) => `${d.key["task_no"] ?? "-"} (${d.scope})`,
        );
        deniedEntries = rcl.denied.map((d) => ({
          task_no: String(d.key["task_no"] ?? "-"),
          scope: String(d.scope ?? "-"),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`${f.name}: 권한 판정 실패로 임포트 중단 — ${msg}`);
        setFiles((cur) =>
          cur.map((x) => (x.id === f.id ? { ...x, status: "failed", error: msg } : x)),
        );
        continue;
      }
      const outOfScope = outOfScopeKeys.length;
      if (outOfScope > 0) {
        toast.warning(
          `${f.name}: 범위 밖이라 반영되지 않은 행 ${outOfScope}건 (결과 카드에서 목록 확인)`,
        );
      }

      // 사용자 선택(mine/all)은 서버 허용 집합 위에 얹는 추가 축소일 뿐이다.
      const parsed =
        effectiveScope === "all"
          ? serverAllowed
          : serverAllowed.filter(
              (p) =>
                mineNames.has(normalizePic(p.hdec_pic_name)) ||
                mineNames.has(normalizePic((p as any).hdec_eng_name)),
            );
      const filteredOut = parsedAll.length - parsed.length;
      const appliedTaskNos = new Set(parsed.map((p) => String(p.task_no ?? "")));
      const scopeFilteredKeys = serverAllowed
        .filter((p) => !appliedTaskNos.has(String(p.task_no ?? "")))
        .map((p) => String(p.task_no ?? "-"));
      // 제외 사유 분리 — 권한(RCL denied) vs 스코프(mine 토글)
      const excludedByPermission = outOfScope;
      const excludedByScope = Math.max(0, serverAllowed.length - parsed.length);
      // 미매핑·강등은 "행 제외"가 아니라 "값 미반영"이다. 항등식 분모를 흐리지 않도록
      // 건수는 0으로 두고, 대상 필드 목록을 로그(jsonb)와 화면에 남긴다.
      const unmappedFieldList = [
        ...(f.unmappedFields ?? []),
        ...(f.demotedFields ?? []).map((d) => d.field),
      ];
      if (parsed.length === 0) {
        toast.warning(
          outOfScope > 0
            ? `${f.name}: 반영 가능한 행이 없습니다 (범위 밖 ${outOfScope}건)`
            : `${f.name}: 본인 담당 행(PIC 또는 ENG: ${mineLabel || "-"})이 없어 임포트를 건너뜁니다`,
        );
        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  status: "done",
                  progress: 100,
                  result: {
                    inserted: 0,
                    updated: 0,
                    skipped: filteredOut,
                    rejected: 0,
                    outOfScope,
                    outOfScopeKeys,
                    parsedRows: parsedAll.length,
                    appliedRows: 0,
                    excludedByScope,
                  },
                }
              : x,
          ),
        );
        continue;
      }
      const scopeNote =
        effectiveScope === "mine"
          ? `Import scope: mine (PIC/ENG=${mineLabel || "-"}); matched ${parsed.length}/${parsedAll.length}; RCL out-of-scope=${outOfScope}`
          : `Import scope: all; rows=${parsed.length}; RCL out-of-scope=${outOfScope}`;
      const startTime = Date.now();
      const startedAtIso = new Date().toISOString();

      // §4-1(2026-08-04): 파서 경고를 로그에 보존. 경고가 없으면 아무것도 남기지 않는다(빈칸).
      const parserWarnings = (f.warnings ?? []).filter(Boolean);
      const warningsPayload =
        parserWarnings.length > 0 || unmappedFieldList.length > 0
          ? {
              parser: parserWarnings,
              has_header_row_fallback: parserWarnings.some((w) => w.includes("헤더 행을 찾지 못해")),
              unmapped_fields: f.unmappedFields ?? [],
              demoted_fields: (f.demotedFields ?? []).map((d) => ({
                field: d.field,
                reason: d.reason,
                ratio: d.ratio,
                samples: d.samples,
              })),
              user_ack_unmapped: !!f.ackUnmapped,
            }
          : null;

      // Create log
      const { data: logRow } = await (supabase as any)
        .from("task_management_import_logs")
        .insert({
          file_name: f.name,
          discipline,
          data_date: f.dataDateOverride ?? f.dataDate ?? null,
          sheet_name: f.sheetName ?? null,
          total_rows: parsedAll.length,
          parsed_rows: parsedAll.length,
          status: "processing",
          imported_by: userId,
          started_at: startedAtIso,
          note: [f.masterMappingNote, scopeNote].filter(Boolean).join(" | ") || null,
          warnings: warningsPayload,
        })
        .select("id")
        .single();
      const logId = logRow?.id;

      setFiles((cur) =>
        cur.map((x) => (x.id === f.id ? { ...x, status: "processing", progress: 0 } : x)),
      );

      // Get existing task_no set (for insert/update count)
      const taskNos = parsed.map((p) => p.task_no);
      const existingSet = new Set<string>();
      const existingSchedule = new Map<
        string,
        { id: string; plan_start: string | null; plan_end: string | null; forecast_end: string | null }
      >();
      const existingByTaskNo = new Map<string, any>();
      const TM_TRACKED_FIELDS = [
        "main_task_no","level","team","category","plot","task_name","risk","sub_task_desc",
        "hdec_pic_name","hdec_eng_name","row_type","status_manual",
        "plan_start","plan_end","actual_start","actual_progress","forecast_end","actual_finish",
      ] as const;
      for (let i = 0; i < taskNos.length; i += 500) {
        const chunk = taskNos.slice(i, i + 500);
        const { data } = await (supabase as any)
          .from("task_management_raw")
          .select("id, task_no, plan_start, plan_end, forecast_end," + TM_TRACKED_FIELDS.filter(f=>!["plan_start","plan_end","forecast_end"].includes(f)).join(","))
          .eq("discipline", discipline)
          .in("task_no", chunk);
        for (const r of data ?? []) {
          existingSet.add(r.task_no);
          existingSchedule.set(r.task_no, {
            id: r.id,
            plan_start: r.plan_start ?? null,
            plan_end: r.plan_end ?? null,
            forecast_end: r.forecast_end ?? null,
          });
          existingByTaskNo.set(r.task_no, r);
        }
      }

      // Rollup 모드에 따라 parent 행의 진도 계열을 어떻게 보낼지 결정
      // 1) task_no 중복 dedupe (엑셀에서 같은 task_no 여러 번 나오면 마지막 값 우선, child > parent)
      const dedupMap = new Map<string, typeof parsed[number]>();
      const dupDetail = new Map<string, number>();
      for (const p of parsed) {
        const key = p.task_no;
        const prev = dedupMap.get(key);
        if (!prev) {
          dedupMap.set(key, p);
        } else {
          dupDetail.set(key, (dupDetail.get(key) ?? 1) + 1);
          // child 우선, 같은 level이면 나중 것 우선
          if (prev.level === "main" && p.level === "sub") {
            dedupMap.set(key, p);
          } else if (prev.level === p.level) {
            dedupMap.set(key, p);
          }
        }
      }
      const duplicates = parsed.length - dedupMap.size;
      if (duplicates > 0) {
        const sample = Array.from(dupDetail.entries())
          .slice(0, 5)
          .map(([k, n]) => `${k}×${n}`)
          .join(", ");
        console.warn(`[task-import] ${f.name} 중복 task_no ${duplicates}건 제거: ${sample}`);
        toast.warning(`${f.name}: 중복 task_no ${duplicates}건 제거 (${sample})`);
      }
      const deduped = Array.from(dedupMap.values());

      // ---- 충돌 정책 적용 (skip / renumber / overwrite) ----
      // 개별 충돌 결정이 있으면 우선, 없으면 파일 기본 conflictPolicy 적용
      const conflictPolicy: ConflictPolicy = f.conflictPolicy ?? "overwrite";
      const conflictSet = new Set<string>(
        (f.preflight?.conflicts ?? []).map((c) => c.task_no),
      );
      const decisions = f.conflictDecisions ?? {};
      let skippedByPolicy = 0;
      let renumbered = 0;
      let resolvedByDecision = 0;
      const renumberMap = new Map<string, string>();
      const applied: typeof deduped = [];
      for (const p of deduped) {
        if (!conflictSet.has(p.task_no)) {
          applied.push(p);
          continue;
        }
        const decision = decisions[p.task_no] ?? conflictPolicy;
        if (decision !== conflictPolicy) {
          resolvedByDecision++;
        }
        if (decision === "overwrite") {
          applied.push(p);
          continue;
        }
        if (decision === "skip") {
          skippedByPolicy++;
          continue;
        }
        // renumber
        try {
          const { task_no: newTaskNo } = await allocateTaskNo({
            data: {
              discipline,
              main_task_no: p.main_task_no ?? null,
            },
          });
          renumberMap.set(p.task_no, newTaskNo);
          applied.push({ ...p, task_no: newTaskNo });
          renumbered++;
        } catch (e) {
          console.warn("[task-import] renumber failed, fallback overwrite", e);
          applied.push(p);
        }
      }
      if (renumberMap.size > 0) {
        // main_task_no가 renumber 대상을 가리키던 자식들도 함께 교체
        for (let i = 0; i < applied.length; i++) {
          const p = applied[i];
          if (p.main_task_no && renumberMap.has(p.main_task_no)) {
            applied[i] = { ...p, main_task_no: renumberMap.get(p.main_task_no)! };
          }
        }
        toast.info(`${f.name}: 충돌 ${renumberMap.size}건 재번호 발급`);
      }
      if (skippedByPolicy > 0) {
        toast.info(`${f.name}: 충돌 ${skippedByPolicy}건 건너뜀`);
      }
      if (resolvedByDecision > 0) {
        toast.info(`${f.name}: 개별 결정 ${resolvedByDecision}건 적용`);
      }

      // ---- 날짜 범위 검증 (J-3) ----
      // DB CHECK 제약(2020-01-01 ~ 2035-12-31)과 동일한 규칙.
      // 실적 정합 제약(C1~C3)과 달리 범위 위반은 명백한 데이터 오류이므로 임포트에서 거부한다.
      const DATE_MIN = "2020-01-01";
      const DATE_MAX = "2035-12-31";
      const DATE_FIELDS = [
        "plan_start",
        "plan_end",
        "actual_start",
        "actual_finish",
        "forecast_end",
      ] as const;
      const dateRangeRejects: { task_no: string; detail: string }[] = [];
      for (let i = applied.length - 1; i >= 0; i--) {
        const p = applied[i] as unknown as Record<string, unknown>;
        const bad: string[] = [];
        for (const fname of DATE_FIELDS) {
          const raw = p[fname];
          if (raw == null || raw === "") continue;
          const s = String(raw).slice(0, 10);
          if (s < DATE_MIN || s > DATE_MAX) bad.push(`${fname}=${s}`);
        }
        if (bad.length > 0) {
          dateRangeRejects.push({
            task_no: String(p.task_no ?? ""),
            detail: bad.join(", "),
          });
          applied.splice(i, 1);
        }
      }
      if (dateRangeRejects.length > 0) {
        const sample = dateRangeRejects
          .slice(0, 3)
          .map((r) => `${r.task_no}(${r.detail})`)
          .join(", ");
        toast.error(
          `${f.name}: 날짜 범위 오류 ${dateRangeRejects.length}건 거부 — ${sample}. 원본 파일의 날짜를 ${DATE_MIN}~${DATE_MAX} 범위로 수정 후 재임포트하세요.`,
        );
      }

      const payloads = applied.map((p) => {
        const isParent = p.level === "main";
        const stripParent = isParent && rollupMode === "auto";
        const row = {
        task_no: p.task_no,
        main_task_no: p.main_task_no,
        level: p.level,
        discipline,
        team: (p.team && p.team.trim()) ? p.team.trim() : discipline,
        category: p.category,
        plot: p.plot,
        task_name: p.task_name,
        risk: p.risk,
        sub_task_desc: p.sub_task_desc,
        hdec_pic_name: p.hdec_pic_name,
        hdec_eng_name: p.hdec_eng_name,
        row_type: p.row_type,
        status_manual: p.status_manual,
        plan_start: stripParent ? null : p.plan_start,
        plan_end: stripParent ? null : p.plan_end,
        // 자동계산 필드는 원본 엑셀값을 무시하고 서버 롤업에서 재계산.
        plan_days: null as number | null,
        actual_start: p.actual_start,
        actual_progress: stripParent ? null : p.actual_progress,
        plan_progress: null as number | null,
        progress_variance: null as number | null,
        forecast_end: p.forecast_end,
        // A.Finish: 엑셀 '실제 완료' 열 값만. null이면 기존 DB값 유지(stripNullExcept).
        actual_finish: stripParent ? null : p.actual_finish,
        // P4-3: 완료일이 실제로 임포트될 때만 출처를 'import' 로 기록. null 이면 기존 값 유지.
        actual_finish_source:
          !stripParent && p.actual_finish ? "import" : (null as string | null),
        // P4-3: 엑셀 진도율 칸에 값이 있는 행만 관측일 기록. null 이면 기존 값 유지.
        progress_observed_at:
          !stripParent && p.progress_cell_present
            ? (f.dataDateOverride ?? f.dataDate ?? null)
            : null,
        slip_days: null as number | null,
        auto_judgment: null as string | null,
        auto_judgment_import: p.auto_judgment,
        // Milestone: 파일에 컬럼이 있고 정규화 성공 시에만 값이 있음. null이면 기존 DB 값 유지(stripNullExcept).
        milestone: p.milestone ?? null,
        data_date: f.dataDateOverride ?? f.dataDate ?? null,
        sort_order: p.sort_order,
        source_file: f.name,
        imported_at: startedAtIso,
        imported_by: userId,
        };
        // 임포트값이 null이면 기존 DB 값을 유지. 자동계산 리셋 필드 및 키/메타는 강제 유지.
        return stripNullExcept(row, [
          "task_no",
          "main_task_no",
          "level",
          "discipline",
          "team",
          // Schedule fields — 원본 파일 값으로 항상 덮어쓰기 (빈 값이면 NULL로 클리어)
          "plan_start",
          "plan_end",
          "forecast_end",
          // 자동계산 리셋 (서버 rollup에서 재계산)
          "plan_days",
          "plan_progress",
          "progress_variance",
          "slip_days",
          "auto_judgment",
          // Main + auto rollup에서 강제 null인 케이스 유지
          ...(stripParent ? (["actual_progress"] as const) : []),
          // 메타
          "data_date",
          "sort_order",
          "source_file",
          "imported_at",
          "imported_by",
        ]);
      });

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;
      const importErrors: ImportErrorEntry[] = [];
      // 실패한 task_no와 사유. row_logs를 정확히 표시하기 위함.
      const rejectedByTaskNo = new Map<string, { reason_code: string; reason_detail?: string }>();
      // 날짜 범위 위반으로 사전 거부된 행 반영
      for (const r of dateRangeRejects) {
        rejectedByTaskNo.set(r.task_no, {
          reason_code: "DATE_RANGE_INVALID",
          reason_detail: `날짜 범위 오류 (${DATE_MIN}~${DATE_MAX}): ${r.detail}`,
        });
        importErrors.push({
          message: `날짜 범위 오류 — ${r.task_no}: ${r.detail}`,
          code: "DATE_RANGE_INVALID",
          batch: 0,
          sampleTaskNo: r.task_no,
        });
      }
      rejected += dateRangeRejects.length;

      try {
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
          if (cancelRequestedRef.current) {
            throw new Error("__CANCELLED__");
          }
          const slice = payloads.slice(i, i + INSERT_CHUNK);
          const batchIndex = Math.floor(i / INSERT_CHUNK);
          const { data, error } = await (supabase as any)
            .from("task_management_raw")
            .upsert(slice, { onConflict: "discipline,task_no" })
            .select("task_no");
          if (error) {
            // 실패한 배치를 row-by-row 재시도해 실제 실패 행/에러를 특정
            console.error("[task-import] batch upsert error", {
              batchIndex,
              error,
              samplePayload: slice[0],
            });
            importErrors.push({
              batch: batchIndex,
              message: (error as any).message,
              code: (error as any).code,
              details: (error as any).details,
              hint: (error as any).hint,
              sampleTaskNo: slice[0]?.task_no,
            });
            let recovered = 0;
            for (const row of slice) {
              const r = await (supabase as any)
                .from("task_management_raw")
                .upsert([row], { onConflict: "discipline,task_no" })
                .select("task_no");
              if (r.error) {
                rejected++;
                const key = String(row.task_no ?? "");
                if (key) {
                  rejectedByTaskNo.set(key, {
                    reason_code: (r.error as any).code || "UPSERT_FAILED",
                    reason_detail: (r.error as any).details || r.error.message,
                  });
                }
                importErrors.push({
                  batch: batchIndex,
                  message: r.error.message,
                  code: r.error.code,
                  details: r.error.details,
                  hint: r.error.hint,
                  sampleTaskNo: row.task_no as string | undefined,
                });
              } else {
                recovered++;
                if (existingSet.has(row.task_no as string)) updated++;
                else inserted++;
              }
            }
            console.warn(
              `[task-import] batch ${batchIndex} row-by-row recovered=${recovered}/${slice.length}`,
            );
          } else {
            for (const r of data ?? []) {
              if (existingSet.has(r.task_no)) updated++;
              else inserted++;
            }
          }
          processed += slice.length;
          const pct = Math.round((processed / Math.max(payloads.length, 1)) * 100);
          setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: pct } : x)));
        }

        // Tag newly-inserted rows with source_import_log_id for rollback tracking.
        if (logId) {
          const newTaskNos = applied
            .map((p) => p.task_no)
            .filter((t) => !existingSet.has(t));
          for (let i = 0; i < newTaskNos.length; i += 500) {
            const chunk = newTaskNos.slice(i, i + 500);
            await (supabase as any)
              .from("task_management_raw")
              .update({ source_import_log_id: logId })
              .eq("discipline", discipline)
              .in("task_no", chunk)
              .is("source_import_log_id", null);
          }

          // Per-row import logs
          try {
            const rowLogRows = applied.map((p, idx) => {
              const rej = rejectedByTaskNo.get(String(p.task_no ?? ""));
              const action = rej
                ? "rejected"
                : existingSet.has(p.task_no)
                  ? "updated"
                  : "inserted";
              return {
                upload_id: logId,
                raw_row_no: idx + 1,
                discipline,
                task_no: p.task_no,
                action_taken: action,
                reason_code: rej?.reason_code ?? null,
                reason_detail: rej?.reason_detail ?? null,
              };
            });
            for (const r of dateRangeRejects) {
              rowLogRows.push({
                upload_id: logId,
                raw_row_no: rowLogRows.length + 1,
                discipline,
                task_no: r.task_no,
                action_taken: "rejected",
                reason_code: "DATE_RANGE_INVALID",
                reason_detail: `날짜 범위 오류 (${DATE_MIN}~${DATE_MAX}): ${r.detail}`,
              });
            }
            // 제외된 행도 사유별로 전부 남긴다(침묵 금지).
            for (const d of deniedEntries) {
              rowLogRows.push({
                upload_id: logId,
                raw_row_no: rowLogRows.length + 1,
                discipline,
                task_no: d.task_no,
                action_taken: "excluded",
                reason_code: "SCOPE_DENIED_PERMISSION",
                reason_detail: `RCL denied — scope=${d.scope}`,
              });
            }
            for (const t of scopeFilteredKeys) {
              rowLogRows.push({
                upload_id: logId,
                raw_row_no: rowLogRows.length + 1,
                discipline,
                task_no: t,
                action_taken: "excluded",
                reason_code: "SCOPE_FILTERED_MINE",
                reason_detail: "본인 담당(PIC/ENG) 아님으로 제외",
              });
            }
            if (unmappedFieldList.length > 0) {
              rowLogRows.push({
                upload_id: logId,
                raw_row_no: rowLogRows.length + 1,
                discipline,
                task_no: "-",
                action_taken: "excluded",
                reason_code: "COLUMN_UNMAPPED",
                reason_detail: `미매핑·강등 컬럼 값 미반영: ${unmappedFieldList.join(", ")}`,
              });
            }
            for (let i = 0; i < rowLogRows.length; i += 500) {
              await (supabase as any)
                .from("task_management_import_row_logs")
                .insert(rowLogRows.slice(i, i + 500));
            }
          } catch (e) {
            console.warn("[task-import] row-log insert failed", e);
          }

          // Field-level logs
          try {
            const pendingFieldLogs: PendingFieldLog[] = [];
            applied.forEach((p, idx) => {
              const taskKey = String(p.task_no ?? "");
              const rawRowNo = idx + 1;
              const rej = rejectedByTaskNo.get(taskKey);
              if (rej) {
                pendingFieldLogs.push(
                  buildFieldLog("task_management", {
                    rawRowNo,
                    field: "__row__",
                    outcome: "rejected_invalid",
                    raw: taskKey,
                    code: rej.reason_code,
                    detail: rej.reason_detail ?? null,
                  }),
                );
                return;
              }
              const prior = existingByTaskNo.get(p.task_no) ?? {};
              const wasExisting = existingSet.has(p.task_no);
              for (const fname of TM_TRACKED_FIELDS) {
                const incoming = (p as any)[fname] ?? null;
                const previous = prior[fname] ?? null;
                const cls = classifyChange(incoming, previous);
                if (cls === "empty") continue;
                pendingFieldLogs.push(
                  buildFieldLog("task_management", {
                    rawRowNo,
                    field: fname,
                    outcome: cls === "applied" ? "applied" : "unchanged",
                    raw: incoming,
                    applied: incoming,
                    previous: wasExisting ? previous : null,
                  }),
                );
              }
            });
            await flushFieldLogs(supabase, logId, userId, pendingFieldLogs);
          } catch (e) {
            console.warn("[task-import] field-log insert failed", e);
          }
        }

        // Schedule Revision audit — Plan Start / Plan End / Forecast End 변경 이력 기록
        try {
          const norm = (v: unknown): string | null => {
            if (v == null || v === "") return null;
            const s = String(v).slice(0, 10);
            return s || null;
          };
          const daysBetween = (a: string | null, b: string | null): number | null => {
            if (!a || !b) return null;
            const da = new Date(a + "T00:00:00Z").getTime();
            const db = new Date(b + "T00:00:00Z").getTime();
            if (Number.isNaN(da) || Number.isNaN(db)) return null;
            return Math.round((db - da) / 86_400_000);
          };
          // 신규 삽입 행의 id를 확보하기 위해 재조회
          const idByTaskNo = new Map<string, string>();
          for (const [k, v] of existingSchedule.entries()) idByTaskNo.set(k, v.id);
          const missingIdTaskNos = applied
            .map((p) => p.task_no)
            .filter((t) => !idByTaskNo.has(t));
          for (let i = 0; i < missingIdTaskNos.length; i += 500) {
            const chunk = missingIdTaskNos.slice(i, i + 500);
            const { data } = await (supabase as any)
              .from("task_management_raw")
              .select("id, task_no")
              .eq("discipline", discipline)
              .in("task_no", chunk);
            for (const r of data ?? []) idByTaskNo.set(r.task_no, r.id);
          }
          // 이전 audit 최신 diff를 stage별로 조회 (prev_gap_days)
          const auditIds = Array.from(idByTaskNo.values());
          const prevGap = new Map<string, { ps: number | null; pe: number | null; fe: number | null }>();
          for (let i = 0; i < auditIds.length; i += 500) {
            const chunk = auditIds.slice(i, i + 500);
            const { data } = await (supabase as any)
              .from("task_schedule_change_audit")
              .select(
                "task_raw_id, plan_start_diff_days, plan_end_diff_days, forecast_end_diff_days, created_at",
              )
              .in("task_raw_id", chunk)
              .order("created_at", { ascending: false });
            for (const r of data ?? []) {
              const key = r.task_raw_id as string;
              const cur = prevGap.get(key) ?? { ps: null, pe: null, fe: null };
              if (cur.ps == null && r.plan_start_diff_days != null) cur.ps = r.plan_start_diff_days;
              if (cur.pe == null && r.plan_end_diff_days != null) cur.pe = r.plan_end_diff_days;
              if (cur.fe == null && r.forecast_end_diff_days != null) cur.fe = r.forecast_end_diff_days;
              prevGap.set(key, cur);
            }
          }
          const auditRows: any[] = [];
          for (const p of applied) {
            const taskRawId = idByTaskNo.get(p.task_no);
            if (!taskRawId) continue;
            const prev = existingSchedule.get(p.task_no);
            const psOld = norm(prev?.plan_start ?? null);
            const peOld = norm(prev?.plan_end ?? null);
            const feOld = norm(prev?.forecast_end ?? null);
            const psNew = norm(p.plan_start);
            const peNew = norm(p.plan_end);
            const feNew = norm(p.forecast_end);
            const psChanged = psOld !== psNew;
            const peChanged = peOld !== peNew;
            const feChanged = feOld !== feNew;
            if (!psChanged && !peChanged && !feChanged) continue;
            const gaps = prevGap.get(taskRawId) ?? { ps: null, pe: null, fe: null };
            auditRows.push({
              created_by: userId,
              import_log_id: logId ?? null,
              task_raw_id: taskRawId,
              task_no: p.task_no,
              main_task_no: p.main_task_no ?? null,
              discipline,
              team: (p.team && p.team.trim()) ? p.team.trim() : discipline,
              plot: p.plot ?? null,
              task_name: p.task_name ?? null,
              hdec_pic_name: p.hdec_pic_name ?? null,
              hdec_eng_name: p.hdec_eng_name ?? null,
              source_file: f.name,
              raw_row_no: null,
              plan_start_old_date: psChanged ? psOld : null,
              plan_start_new_date: psChanged ? psNew : null,
              plan_start_diff_days: psChanged ? daysBetween(psOld, psNew) : null,
              plan_start_prev_gap_days: psChanged ? gaps.ps : null,
              plan_start_cur_gap_days: daysBetween(psNew, peNew),
              plan_end_old_date: peChanged ? peOld : null,
              plan_end_new_date: peChanged ? peNew : null,
              plan_end_diff_days: peChanged ? daysBetween(peOld, peNew) : null,
              plan_end_prev_gap_days: peChanged ? gaps.pe : null,
              plan_end_cur_gap_days: daysBetween(peNew, feNew),
              forecast_end_old_date: feChanged ? feOld : null,
              forecast_end_new_date: feChanged ? feNew : null,
              forecast_end_diff_days: feChanged ? daysBetween(feOld, feNew) : null,
              forecast_end_prev_gap_days: feChanged ? gaps.fe : null,
            });
          }
          for (let i = 0; i < auditRows.length; i += 500) {
            const { error } = await (supabase as any)
              .from("task_schedule_change_audit")
              .insert(auditRows.slice(i, i + 500));
            if (error) {
              console.warn("[task-import] schedule audit insert failed", error);
            }
          }
          if (auditRows.length > 0) {
            console.info(`[task-import] schedule-revision audit rows=${auditRows.length}`);
          }
        } catch (e) {
          console.warn("[task-import] schedule audit build failed", e);
        }

        // Post-import: rollup + judgment recalc
        let rolledUp = 0;
        let judgmentRecalculated = 0;
        try {
          if (rollupMode !== "keep") {
            const res = await runRollupAllMains({
              data: { discipline },
            });
            rolledUp = res.rolledUp;
          }
        } catch (e) {
          console.error("[task-import] rollup failed", e);
          importErrors.push({
            batch: -1,
            message: `Rollup 실패: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        try {
          if (recalcJudgment) {
            const res = await runRecalcAutoJudgment({
              data: { discipline },
            });
            judgmentRecalculated = res.updated;
          }
        } catch (e) {
          console.error("[task-import] judgment recalc failed", e);
          importErrors.push({
            batch: -1,
            message: `Judgment 재계산 실패: ${e instanceof Error ? e.message : String(e)}`,
          });
        }

        // 반영 행수가 파싱 행수와 같을 때만 success. 제외·거부가 하나라도 있으면 partial.
        const appliedRows = inserted + updated;
        const unclassified = Math.max(
          0,
          parsedAll.length -
            (appliedRows +
              excludedByPermission +
              excludedByScope +
              duplicates +
              rejected +
              skippedByPolicy),
        );
        const finalStatus =
          appliedRows === 0
            ? "failed"
            : appliedRows === parsedAll.length && rejected === 0 && importErrors.length === 0
              ? "success"
              : "partial";

        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
            .update({
              status: finalStatus,
              inserted,
              updated,
              rejected,
              applied_rows: appliedRows,
              exclusions: {
                excluded_by_permission: excludedByPermission,
                excluded_by_scope: excludedByScope,
                excluded_unmapped_fields: unmappedFieldList,
                duplicates,
                skipped_by_policy: skippedByPolicy,
                rolled_up: rolledUp,
                renumbered,
                resolved_by_decision: resolvedByDecision,
                unclassified,
              },
              errors: importErrors.length ? importErrors : null,
              finished_at: new Date().toISOString(),
            })
            .eq("id", logId);
        }

        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  status: "done",
                  progress: 100,
                  result: {
                    inserted,
                    updated,
                    skipped: skippedByPolicy,
                    rejected,
                    duplicates,
                    rolledUp,
                    judgmentRecalculated,
                    renumbered,
                    resolvedByDecision,
                    outOfScope,
                    outOfScopeKeys,
                    parsedRows: parsedAll.length,
                    appliedRows,
                    excludedByScope,
                    unclassified,
                    errors: importErrors.length ? importErrors : undefined,
                  },
                }
              : x,
          ),
        );
        if (importErrors.length && inserted + updated === 0) {
          toast.error(`${f.name}: 전체 실패 — 첫 에러: ${importErrors[0].message}`);
        } else if (rejected > 0) {
          toast.warning(
            `${f.name}: ${rejected}행 rejected. 콘솔에서 상세 확인.`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cancelled = msg === "__CANCELLED__";
        console.error("[task-import] fatal", e);
        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
            .update({
              status: cancelled ? "cancelled" : "failed",
              errors: cancelled ? null : [{ batch: -1, message: msg }],
              finished_at: new Date().toISOString(),
            })
            .eq("id", logId);
        }
        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  status: "failed",
                  error: cancelled
                    ? `사용자 취소 — 처리 ${processed}/${payloads.length}행`
                    : msg,
                }
              : x,
          ),
        );
      }

      void startTime;
    }

    setIsRunning(false);
    if (cancelRequestedRef.current) {
      toast.info("Task Management import 취소됨");
    } else {
      toast.success(`Task Management import 완료: ${ready.length} file(s)`);
    }
  }, [rollupMode, recalcJudgment]);

  const startImport = useCallback(async () => {
    if (isRunning) return;
    const missingDiscipline = files.some(
      (f) => f.status === "ready" && !f.validationError && !f.discipline,
    );
    if (missingDiscipline) {
      toast.error("공종을 선택하세요 (선택없음 상태에서는 임포트할 수 없습니다)");
      return;
    }
    const ready = files.filter(
      (f) =>
        f.status === "ready" &&
        f.parsed &&
        f.parsed.length > 0 &&
        !f.validationError &&
        !!f.discipline &&
        !!(f.dataDateOverride ?? f.dataDate),
    );
    if (ready.length === 0) {
      toast.error("Import 가능한 파일이 없습니다");
      return;
    }
    cancelRequestedRef.current = false;
    setIsCancelling(false);
    setIsRunning(true);
    try {
      await takePreImportSnapshotWithFeedback("tm");
    } catch {
      // toast 메시지는 takePreImportSnapshotWithFeedback 내부에서 처리
    }
    try {
      await executeImport(ready);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[tm-import] start failed", e);
      toast.error(`Task Management import 실패: ${msg}`);
    } finally {
      setIsRunning(false);
      cancelRequestedRef.current = false;
      setIsCancelling(false);
    }
  }, [files, isRunning, executeImport]);

  return (
    <Ctx.Provider
      value={{
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
        importerHdecPicName,
        setImporterHdecPicName,
        importerOwnNames,
        setImporterOwnNames,
        isImporterAdmin,
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
      }}
    >
      {children}
    </Ctx.Provider>
  );
}