import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
// Parser statically imports the `xlsx` package (~425KB gzip 177KB) via
// `src/lib/defect-management/parser.ts`. This Provider is mounted from
// `__root.tsx`, so any static import here pulls xlsx into the entry chunk
// and every unauthenticated route (including /auth) pays the download cost.
// Types are erased at build time — safe to static-import. Runtime callables
// are loaded on demand via `await import()` inside the async handlers below.
import type {
  DefectSheetHeader,
  DefectTargetField,
  ParsedDefectRow,
} from "@/lib/defect-management/parser";
type DefectParserModule = typeof import("@/lib/defect-management/parser");
let defectParserPromise: Promise<DefectParserModule> | null = null;
function loadDefectParser(): Promise<DefectParserModule> {
  if (!defectParserPromise) {
    defectParserPromise = import("@/lib/defect-management/parser");
  }
  return defectParserPromise;
}
import { deriveRectifiedStatus, deriveClosureStatus } from "@/lib/defect-management/derived";
import {
  resolvePlotFromPlanGroup,
  resolveSubcon,
} from "@/lib/defect-management/auto-fill-rules";
import type { DefectTeam } from "@/lib/defect-management/columns";
import { DEFECT_TEAMS } from "@/lib/defect-management/columns";
import { computeTargets, mergeClassification, runRuleStage, type ClassifyRequestItem } from "@/lib/defect-management/classifier/apply-classification";
import { buildFieldLog, classifyChange, flushFieldLogs, type PendingFieldLog } from "@/lib/import/field-log";
import { bulkClassifyDefects } from "@/lib/defect-management/classifier/bulk-classify.functions";
import { CLASSIFIER_FIELDS } from "@/lib/defect-management/classifier/rules";
import { takePreImportSnapshotWithFeedback } from "@/lib/backup/pre-import-snapshot";

export type DefectFileStatus =
  | "parsing"
  | "pending_sheet_selection"
  | "pending_duplicate_review"
  | "ready"
  | "processing"
  | "done"
  | "failed";

export interface DefectImportError {
  batch: number;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  sampleId?: string;
}

export type DuplicateStrategy = "keep_last" | "keep_first" | "manual";

export interface DuplicateGroupRow {
  parsedIndex: number;
  preview: {
    description?: string | null;
    status_raw?: string | null;
    updated_date_raw?: string | null;
    created_date?: string | null;
    updated_by_name?: string | null;
    updated_status?: string | null;
  };
}

export interface DuplicateGroup {
  key: string; // source_issue_no
  rows: DuplicateGroupRow[];
  selectedParsedIndex: number;
}

export interface DefectImportFile {
  id: string;
  file: File;
  name: string;
  size: number;
  status: DefectFileStatus;
  progress: number;
  parsed?: ParsedDefectRow[];
  sheetName?: string;
  sheetNames?: string[];
  sheetHeaders?: DefectSheetHeader[];
  columnMap?: Record<string, number>;
  columnOverrides?: Partial<Record<DefectTargetField, number>> | null;
  availableHeaders?: string[];
  headerSamples?: Record<string, unknown>;
  headerToFieldMap?: Record<string, string>;
  excludedHeaders?: string[];
  excludedFields?: Set<string>;
  dateIssues?: import("@/lib/import/date-audit").DateIssue[];
  dateOverrides?: Record<string, string>;
  isReimport?: boolean;
  warnings?: string[];
  categorySummary?: string[];
  dataDateOverride?: string | null;
  validationError?: string | null;
  error?: string;
  result?: {
    inserted: number;
    updated: number;
    skippedLocked: number;
    rejected: number;
    duplicates: number;
    skippedReimportNoMatch?: number;
    unmappedCategoryCount?: number;
    unmappedCategories?: string[];
    errors?: DefectImportError[];
  };
  classificationResult?: {
    skippedRows: number;
    ruleOnlyRows: number;
    llmRows: number;
    llmUpdated: number;
    llmFailed: number;
  };
  duplicateStrategy?: DuplicateStrategy;
  duplicateGroups?: DuplicateGroup[];
  autoDedupedIdenticalCount?: number;
  aiClassifyEnabled?: boolean;
  /** 임포트 로그 note 에 추가할 미해결 마스터 이름 요약. */
  masterMappingNote?: string;
}

interface CtxValue {
  files: DefectImportFile[];
  isRunning: boolean;
  isCancelling: boolean;
  requestCancel: () => void;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  setFileDataDateOverride: (id: string, date: string | null) => void;
  setFileSheet: (id: string, sheetName: string) => Promise<void>;
  setFileExcludedHeaders: (id: string, excluded: string[]) => Promise<void>;
  setFileDateOverrides: (id: string, overrides: Record<string, string>) => Promise<void>;
  setFileDuplicateStrategy: (id: string, strategy: DuplicateStrategy) => void;
  setFileDuplicateSelection: (id: string, groupKey: string, parsedIndex: number) => void;
  resolveDuplicates: (id: string) => void;
  startImport: () => Promise<void>;
  setFileAiClassifyEnabled: (id: string, enabled: boolean) => void;
  setFileParsedRows: (id: string, next: ParsedDefectRow[]) => void;
  setFileMasterMappingNote: (id: string, note: string) => void;
  /**
   * 관리자 탭에서 헤더 매핑을 방금 수정한 경우, DB의 최신 alias를 다시 읽어
   * 이미 파싱된 파일의 headerToFieldMap 만 재계산한다(원본 파일 재파싱 없음).
   * 반환값은 갱신된 alias 개수.
   */
  refreshAliases: () => Promise<number>;
}

const Ctx = createContext<CtxValue | null>(null);

export function useDefectImport() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDefectImport must be used within provider");
  return c;
}

const INSERT_CHUNK = 100;
// 대량 upsert는 DB 트리거/인덱스 갱신과 맞물리면 500행×고병렬에서 statement timeout이 난다.
// 작은 배치와 낮은 병렬성으로 안정성을 우선 확보한다.
const BATCH_CONCURRENCY = 2;
const EXISTING_FETCH_CHUNK = 100;
const EXISTING_FETCH_CONCURRENCY = 4;
const ROW_LOG_CHUNK = 500;
const RETRY_DELAYS_MS = [300, 800, 2000];
const PROGRESS_UPDATE_MS = 200;

/** 배열을 지정 동시성으로 순회하며 각 항목에 대해 worker를 실행. 결과는 입력 순서 유지. */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * parsed 배열에서 source_issue_no 기준 중복 그룹을 계산한다.
 * - raw_payload JSON 문자열이 동일한 완전 동일 중복은 자동 폐기 카운트에 반영하고 후보에서 제거.
 * - 자동 dedupe 후 후보가 2개 이상 남는 그룹만 사용자 검토 대상으로 반환.
 * - 초기 selectedParsedIndex 는 그룹 마지막 후보 (keep_last).
 */
function computeDuplicateGroups(parsed: ParsedDefectRow[]): {
  groups: DuplicateGroup[];
  autoDedupedIdenticalCount: number;
} {
  // 1) source_issue_no 별로 [ {idx, row} ] 수집
  const byKey = new Map<string, Array<{ idx: number; row: ParsedDefectRow }>>();
  parsed.forEach((row, idx) => {
    const key = row.source_issue_no;
    if (!key) return;
    const list = byKey.get(key) ?? [];
    list.push({ idx, row });
    byKey.set(key, list);
  });

  const groups: DuplicateGroup[] = [];
  let autoDedupedIdenticalCount = 0;

  for (const [key, items] of byKey) {
    if (items.length < 2) continue;
    // 2) raw_payload JSON 동일 → 마지막만 남기고 나머지 자동 폐기
    const uniqByPayload = new Map<string, { idx: number; row: ParsedDefectRow }>();
    for (const item of items) {
      const sig = JSON.stringify(item.row.raw_payload ?? {});
      uniqByPayload.set(sig, item); // keep last
    }
    const kept = Array.from(uniqByPayload.values()).sort((a, b) => a.idx - b.idx);
    autoDedupedIdenticalCount += items.length - kept.length;
    if (kept.length < 2) continue;

    // 3) 사용자 검토 대상
    const rows: DuplicateGroupRow[] = kept.map(({ idx, row }) => ({
      parsedIndex: idx,
      preview: {
        description: row.description ?? null,
        status_raw: row.status_raw ?? null,
        updated_date_raw: row.updated_date_raw ?? null,
        created_date: row.created_date ?? null,
        updated_by_name: row.updated_by_name ?? null,
        updated_status: row.updated_status ?? null,
      },
    }));
    groups.push({
      key,
      rows,
      selectedParsedIndex: rows[rows.length - 1].parsedIndex, // keep_last
    });
  }

  return { groups, autoDedupedIdenticalCount };
}

/** 전략에 따라 그룹의 selectedParsedIndex 재계산 (manual 은 유지). */
function applyStrategyToGroups(
  groups: DuplicateGroup[],
  strategy: DuplicateStrategy,
): DuplicateGroup[] {
  if (strategy === "manual") return groups;
  return groups.map((g) => ({
    ...g,
    selectedParsedIndex:
      strategy === "keep_first"
        ? g.rows[0].parsedIndex
        : g.rows[g.rows.length - 1].parsedIndex,
  }));
}

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    (err as { message?: string })?.message ??
    (typeof err === "string" ? err : "");
  const details = (err as { details?: string })?.details ?? "";
  const combined = `${msg} ${details}`.toLowerCase();
  return (
    combined.includes("failed to fetch") ||
    combined.includes("networkerror") ||
    combined.includes("network error") ||
    combined.includes("fetch failed") ||
    combined.includes("load failed")
  );
}

function isStatementTimeout(err: unknown): boolean {
  return (
    (err as { code?: string } | null)?.code === "57014" ||
    String((err as { message?: string } | null)?.message ?? "")
      .toLowerCase()
      .includes("statement timeout")
  );
}

function validate(f: DefectImportFile): string | null {
  if (!f.parsed || f.parsed.length === 0) return "행을 찾지 못했습니다.";
  if ((f.duplicateGroups?.length ?? 0) > 0) {
    return `동일 Issue No 중복이 ${f.duplicateGroups!.length}그룹 감지되었습니다. "중복 검토"를 완료하세요.`;
  }
  if ((f.dateIssues?.length ?? 0) > 0) {
    return `날짜 형식 오류 ${f.dateIssues!.length}건이 있습니다. 아래 목록에서 수정 후 재파싱하세요.`;
  }
  return null;
}

export function DefectManagementImportProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<DefectImportFile[]>([]);
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

  const fetchAliases = useCallback(async (): Promise<Record<string, string[]>> => {
    const extraAliases: Record<string, string[]> = {};
    try {
      const { data } = await (supabase as any)
        .from("defect_header_mappings")
        .select("source_header, target_field, is_active")
        .eq("is_active", true);
      for (const m of (data ?? []) as Array<{ source_header: string; target_field: string }>) {
        if (!m.target_field || !m.source_header) continue;
        (extraAliases[m.target_field] ||= []).push(m.source_header);
      }
    } catch {
      // ignore
    }
    return extraAliases;
  }, []);

  /**
   * 배치 upsert 재시도 헬퍼. 네트워크성 오류는 재시도, 그 외 즉시 반환.
   */
  const upsertBatch = useCallback(async (slice: Record<string, unknown>[]) => {
    let error: any = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const res = await (supabase as any)
        .from("defect_items_raw")
        .upsert(slice, { onConflict: "source_issue_no" });
      error = res.error;
      if (!error) return { error: null };
      if (!isNetworkError(error)) break;
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
    return { error };
  }, []);

  /**
   * 배치가 실패했을 때 이분 탐색으로 성공/실패 행을 가려냄.
   * O(log N + K) 회의 왕복으로 대량 성공 행을 빠르게 통과시키고, 실패 행만 개별 upsert.
   * 반환: { insertedRows, updatedRows, rejectedRows, rowErrors }.
   */
  const upsertWithBinarySplit = useCallback(
    async (
      slice: Record<string, unknown>[],
      batchIndex: number,
    ): Promise<{
      insertedRows: Array<Record<string, unknown>>;
      updatedRows: Array<Record<string, unknown>>;
      rejectedRows: Array<Record<string, unknown>>;
      rowErrors: DefectImportError[];
      firstError: any;
    }> => {
      const insertedRows: Array<Record<string, unknown>> = [];
      const updatedRows: Array<Record<string, unknown>> = [];
      const rejectedRows: Array<Record<string, unknown>> = [];
      const rowErrors: DefectImportError[] = [];
      let firstError: any = null;

      const stack: Array<Record<string, unknown>[]> = [slice];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.length === 0) continue;
        const { error } = await upsertBatch(current);
        if (!error) {
          for (const row of current) {
            (row as any).__ok = true;
          }
          continue;
        }
        if (!firstError) firstError = error;
        // 결정적 데이터 오류(NOT NULL / CHECK / FK 등)는 분할해도 결과가 바뀌지 않으므로
        // 즉시 개별 실패로 처리하여 O(N) 왕복 폭발을 방지한다.
        const code = (error as any)?.code as string | undefined;
        const isDeterministic =
          code === "23502" || code === "23514" || code === "23503" || code === "22P02";
        if (current.length === 1 || isDeterministic) {
          for (const row of current) {
            rejectedRows.push(row);
            rowErrors.push({
              batch: batchIndex,
              message: error.message,
              code: (error as any).code,
              details: (error as any).details,
              hint: (error as any).hint,
              sampleId: row.source_issue_no as string,
            });
          }
          continue;
        }
        if (current.length === 1) {
          rejectedRows.push(current[0]);
          rowErrors.push({
            batch: batchIndex,
            message: error.message,
            code: (error as any).code,
            details: (error as any).details,
            hint: (error as any).hint,
            sampleId: current[0].source_issue_no as string,
          });
          continue;
        }
        const mid = Math.floor(current.length / 2);
        stack.push(current.slice(mid));
        stack.push(current.slice(0, mid));
      }

      // 성공 표시된 행을 inserted/updated로 분류
      // (분류는 호출측에서 existing 맵을 이용해 수행)
      return { insertedRows, updatedRows, rejectedRows, rowErrors, firstError };
    },
    [upsertBatch],
  );

  /** file.file을 실제로 파싱하고 결과로 파일 상태를 업데이트. */
  const parseAndApply = useCallback(
    async (id: string, file: File, sheetName?: string, excludedHeaders?: string[]) => {
      const extraAliases = await fetchAliases();
      let dateOverrides: Record<string, string> = {};
      setFiles((cur) => {
        const t = cur.find((f) => f.id === id);
        dateOverrides = t?.dateOverrides ?? {};
        return cur;
      });
      try {
        const { parseDefectExcel } = await loadDefectParser();
        const parsed = await parseDefectExcel(file, {
          extraAliases,
          sheetName,
          excludedHeaders,
          dateOverrides,
        });
        setFiles((cur) =>
          cur.map((f) => {
            if (f.id !== id) return f;
            const { groups, autoDedupedIdenticalCount } = computeDuplicateGroups(parsed.rows);
            const hasUnresolvedDuplicates = groups.length > 0;
            const strategy: DuplicateStrategy = f.duplicateStrategy ?? "keep_last";
            const groupsWithStrategy = applyStrategyToGroups(groups, strategy);
            const nextStatus: DefectFileStatus = hasUnresolvedDuplicates
              ? "pending_duplicate_review"
              : "ready";
            const updated: DefectImportFile = {
              ...f,
              parsed: parsed.rows,
              sheetName: parsed.sheetName,
              sheetHeaders: parsed.sheetHeaders,
              columnMap: parsed.columnMap,
              availableHeaders: parsed.availableHeaders,
              headerSamples: parsed.headerSamples,
              headerToFieldMap: parsed.headerToFieldMap,
              excludedHeaders: parsed.excludedHeaders,
              excludedFields: parsed.excludedFields,
              dateIssues: parsed.dateIssues,
              isReimport: parsed.isReimport,
              warnings: parsed.warnings,
              categorySummary: parsed.categorySummary,
              status: nextStatus,
              duplicateStrategy: strategy,
              duplicateGroups: groupsWithStrategy,
              autoDedupedIdenticalCount,
              error: undefined,
            };
            updated.validationError = validate(updated);
            return updated;
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
    [fetchAliases],
  );

  const addFiles = useCallback(async (selected: File[]) => {
    const excel = selected.filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    const next: DefectImportFile[] = excel.map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      name: file.name,
      size: file.size,
      status: "parsing",
      progress: 0,
      aiClassifyEnabled: false,
    }));
    setFiles((cur) => [...cur, ...next]);

    for (const item of next) {
      try {
        const { getDefectExcelSheetNames, getDefectExcelHeaders } =
          await loadDefectParser();
        const sheetNames = await getDefectExcelSheetNames(item.file);
        setFiles((cur) =>
          cur.map((f) => (f.id === item.id ? { ...f, sheetNames } : f)),
        );
        if (sheetNames.length > 1) {
          // 다중 시트 → 사용자 선택 대기
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id ? { ...f, status: "pending_sheet_selection" } : f,
            ),
          );
          continue;
        }
        // 헤더 프리뷰 캡처
        const headerInfo = await getDefectExcelHeaders(item.file);
        if (headerInfo) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    availableHeaders: headerInfo.headers,
                    headerSamples: headerInfo.sample,
                    isReimport: headerInfo.isReimport,
                    excludedHeaders: [],
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
              ? { ...f, status: "failed", error: e instanceof Error ? e.message : "Parse failed" }
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
    (id: string, next: ParsedDefectRow[]) => {
      setFiles((cur) =>
        cur.map((f) => (f.id === id ? { ...f, parsed: next } : f)),
      );
    },
    [],
  );

  const setFileMasterMappingNote = useCallback(
    (id: string, note: string) => {
      setFiles((cur) =>
        cur.map((f) => (f.id === id ? { ...f, masterMappingNote: note } : f)),
      );
    },
    [],
  );

  const setFileDataDateOverride = useCallback((id: string, date: string | null) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, dataDateOverride: date } : f)));
  }, []);

  const setFileAiClassifyEnabled = useCallback((id: string, enabled: boolean) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, aiClassifyEnabled: enabled } : f)));
  }, []);

  const setFileSheet = useCallback(
    async (id: string, sheetName: string) => {
      let target: DefectImportFile | undefined;
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
        const { getDefectExcelHeaders } = await loadDefectParser();
        const headerInfo = await getDefectExcelHeaders(target.file, sheetName);
        if (headerInfo) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === id
                ? {
                    ...f,
                    availableHeaders: headerInfo.headers,
                    headerSamples: headerInfo.sample,
                    isReimport: headerInfo.isReimport,
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
      let target: DefectImportFile | undefined;
      setFiles((cur) => {
        target = cur.find((f) => f.id === id);
        return cur.map((f) =>
          f.id === id
            ? { ...f, status: "parsing", excludedHeaders: excluded }
            : f,
        );
      });
      if (!target) return;
      await parseAndApply(id, target.file, target.sheetName, excluded);
    },
    [parseAndApply],
  );

  const setFileDateOverrides = useCallback(
    async (id: string, overrides: Record<string, string>) => {
      let target: DefectImportFile | undefined;
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

  const setFileDuplicateStrategy = useCallback(
    (id: string, strategy: DuplicateStrategy) => {
      setFiles((cur) =>
        cur.map((f) => {
          if (f.id !== id) return f;
          const groups = applyStrategyToGroups(f.duplicateGroups ?? [], strategy);
          return { ...f, duplicateStrategy: strategy, duplicateGroups: groups };
        }),
      );
    },
    [],
  );

  const setFileDuplicateSelection = useCallback(
    (id: string, groupKey: string, parsedIndex: number) => {
      setFiles((cur) =>
        cur.map((f) => {
          if (f.id !== id) return f;
          const groups = (f.duplicateGroups ?? []).map((g) =>
            g.key === groupKey ? { ...g, selectedParsedIndex: parsedIndex } : g,
          );
          return {
            ...f,
            duplicateStrategy: "manual",
            duplicateGroups: groups,
          };
        }),
      );
    },
    [],
  );

  const resolveDuplicates = useCallback((id: string) => {
    setFiles((cur) =>
      cur.map((f) => {
        if (f.id !== id) return f;
        if (!f.parsed || !f.duplicateGroups || f.duplicateGroups.length === 0) return f;
        const dropIndices = new Set<number>();
        for (const g of f.duplicateGroups) {
          for (const r of g.rows) {
            if (r.parsedIndex !== g.selectedParsedIndex) dropIndices.add(r.parsedIndex);
          }
        }
        const nextParsed = f.parsed.filter((_, idx) => !dropIndices.has(idx));
        const nextStatus: DefectFileStatus = "ready";
        const updated: DefectImportFile = {
          ...f,
          parsed: nextParsed,
          duplicateGroups: [],
          status: nextStatus,
        };
        updated.validationError = validate(updated);
        return updated;
      }),
    );
  }, []);

  const executeImport = useCallback(async (ready: DefectImportFile[]) => {
    setIsRunning(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    // Category → Team 매핑 조회 (1회)
    const teamByCategory = new Map<string, DefectTeam>();
    try {
      const { data: mapRows } = await (supabase as any)
        .from("defect_category_team_map")
        .select("category, team");
      for (const m of (mapRows ?? []) as Array<{ category: string; team: string }>) {
        if (m.category && m.team && (DEFECT_TEAMS as readonly string[]).includes(m.team)) {
          teamByCategory.set(String(m.category).trim(), m.team as DefectTeam);
        }
      }
    } catch (e) {
      console.warn("[defect-import] category_team_map fetch failed", e);
    }
    const resolveTeam = (category: string | null | undefined): DefectTeam | null => {
      if (!category) return null;
      return teamByCategory.get(String(category).trim()) ?? null;
    };

    // Subcon 자동 채움 rule 조회
    // (2026-08-04) HDEC PIC/ENG 자동 채움은 폐지 — 담당자 값은 파일/명부 정본만 사용한다.
    let subconRules: import("@/lib/defect-management/auto-fill-rules").SubconRule[] = [];
    try {
      const sRes = await (supabase as any)
        .from("defect_subcon_rules")
        .select("id, plot, room_group, trade_keywords, subcontractor_name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      subconRules = (sRes.data ?? []) as typeof subconRules;
    } catch (e) {
      console.warn("[defect-import] auto-fill rules fetch failed", e);
    }
    /** 파일의 team 값을 DEFECT_TEAMS 기준으로 정규화. 유효하지 않으면 null. */
    const normalizeFileTeam = (raw: unknown): DefectTeam | null => {
      if (raw == null) return null;
      const s = String(raw).trim();
      if (!s) return null;
      const lower = s.toLowerCase();
      for (const t of DEFECT_TEAMS) {
        if (t.toLowerCase() === lower) return t;
      }
      return null;
    };
    /** 파일 team 우선, 없으면 category 자동 매핑. */
    const pickTeam = (p: ParsedDefectRow): DefectTeam | null => {
      const fromFile = normalizeFileTeam(p.extra?.team);
      if (fromFile) return fromFile;
      return resolveTeam(p.category);
    };

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
      const parsed = f.parsed ?? [];
      const dataDate = f.dataDateOverride ?? todayInDoha();
      const startedAtIso = new Date().toISOString();
      const excludedFields = f.excludedFields ?? new Set<string>();
      const isReimport = !!f.isReimport;
      const duplicateStrategy = f.duplicateStrategy ?? "keep_last";
      const duplicatesAuto = f.autoDedupedIdenticalCount ?? 0;

      const { data: logRow } = await (supabase as any)
        .from("defect_import_logs")
        .insert({
          file_name: f.name,
          team: null,
          data_date: dataDate,
          sheet_name: f.sheetName ?? null,
          total_rows: parsed.length,
          status: "processing",
          imported_by: userId,
          started_at: startedAtIso,
          note: [
            isReimport ? "reimport=true" : null,
            excludedFields.size > 0
              ? `excluded_fields=${Array.from(excludedFields).join(",")}`
              : null,
            `duplicate_strategy=${duplicateStrategy}`,
            duplicatesAuto > 0 ? `duplicates_auto=${duplicatesAuto}` : null,
            f.masterMappingNote ? f.masterMappingNote : null,
          ]
            .filter(Boolean)
            .join(" | ") || null,
        })
        .select("id")
        .single();
      const logId = logRow?.id as string | undefined;

      setFiles((cur) =>
        cur.map((x) => (x.id === f.id ? { ...x, status: "processing", progress: 0 } : x)),
      );

      // 파일 카드에서 이미 중복이 해결되었으므로 방어적 dedupe (keep last) 유지.
      // 통계에는 자동 폐기 카운트만 노출 (수동 폐기분은 이미 parsed 에서 제거됨).
      const dedupMap = new Map<string, ParsedDefectRow>();
      for (const p of parsed) dedupMap.set(p.source_issue_no, p);
      const deduped = Array.from(dedupMap.values());
      const duplicatesDefensive = parsed.length - deduped.length;
      const duplicates = duplicatesAuto + duplicatesDefensive;

      // 기존 행 조회 (id + lock flags) — 청크를 병렬로 조회
      setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: 2 } : x)));
      const ids = deduped.map((p) => p.source_issue_no);
      const existing = new Map<
        string,
        {
          priority_locked: boolean;
          hdec_verification_locked: boolean;
          actual_closure_date: string | null;
          actual_rectified_date: string | null;
          actual_start_date: string | null;
          rectified_status: string | null;
          closure_status: string | null;
          defect_location: string | null;
          main_trade: string | null;
          sub_trade: string | null;
          work_type: string | null;
          hdec_pic_name: string | null;
          hdec_eng_name: string | null;
          subcontractor_name: string | null;
        }
      >();
      const idChunks: string[][] = [];
      for (let i = 0; i < ids.length; i += EXISTING_FETCH_CHUNK) {
        idChunks.push(ids.slice(i, i + EXISTING_FETCH_CHUNK));
      }
      await runWithConcurrency(idChunks, EXISTING_FETCH_CONCURRENCY, async (chunk) => {
        const { data, error } = await (supabase as any)
          .from("defect_items_raw")
          .select("source_issue_no, priority_locked, hdec_verification_locked, actual_closure_date, actual_rectified_date, actual_start_date, rectified_status, closure_status, defect_location, main_trade, sub_trade, work_type, hdec_pic_name, hdec_eng_name, subcontractor_name")
          .in("source_issue_no", chunk);
        if (error) {
          throw new Error(
            `기존 Snag 조회 실패: ${error.message}${error.details ? ` (${error.details})` : ""}`,
          );
        }
        for (const r of (data ?? []) as any[]) {
          existing.set(r.source_issue_no, {
            priority_locked: !!r.priority_locked,
            hdec_verification_locked: !!r.hdec_verification_locked,
            actual_closure_date: r.actual_closure_date ?? null,
            actual_rectified_date: r.actual_rectified_date ?? null,
            actual_start_date: r.actual_start_date ?? null,
            rectified_status: r.rectified_status ?? null,
            closure_status: r.closure_status ?? null,
            defect_location: r.defect_location ?? null,
            main_trade: r.main_trade ?? null,
            sub_trade: r.sub_trade ?? null,
            work_type: r.work_type ?? null,
            hdec_pic_name: r.hdec_pic_name ?? null,
            hdec_eng_name: r.hdec_eng_name ?? null,
            subcontractor_name: r.subcontractor_name ?? null,
          });
        }
      });

      // Re-import: 기존 매칭 실패한 행은 건너뜀
      const skippedReimportNoMatch = isReimport
        ? deduped.filter((p) => !existing.has(p.source_issue_no)).length
        : 0;
      const workingRows = isReimport
        ? deduped.filter((p) => existing.has(p.source_issue_no))
        : deduped;

      /**
       * 필드가 excludedFields에 있거나 값이 null/undefined이면 payload에서 제외
       * (기존 DB 값 보존). 임포트로는 값을 null로 덮어쓸 수 없다.
       */
      const put = (base: Record<string, unknown>, field: string, value: unknown) => {
        if (excludedFields.has(field)) return;
        if (value === null || value === undefined) return;
        base[field] = value;
      };

      const unmappedCategories = new Map<string, number>();
      const payloads = workingRows.map((p) => {
        const prev = existing.get(p.source_issue_no);
        const skipPriority = prev?.priority_locked;
        const skipVerification = prev?.hdec_verification_locked;
        const rowTeam = pickTeam(p);
        if (!rowTeam && p.category) {
          unmappedCategories.set(p.category, (unmappedCategories.get(p.category) ?? 0) + 1);
        }
        const base: Record<string, unknown> = {
          team: rowTeam,
          data_date: dataDate,
          source_issue_no: p.source_issue_no,
          raw_payload: p.raw_payload,
          source_import_log_id: logId,
          updated_by: userId,
          is_active: true,
        };
        put(base, "location_raw", p.location_raw);
        put(base, "defect_location", p.defect_location);
        put(base, "plan_title", p.plan_title);
        put(base, "plan_group", p.plan_group);
        put(base, "status_raw", p.status_raw);
        put(base, "assigned_to", p.assigned_to);
        put(base, "category", p.category);
        put(base, "defect_type", p.defect_type);
        put(base, "item", p.item);
        put(base, "description", p.description);
        put(base, "due_by", p.due_by);
        put(base, "created_by_name", p.created_by_name);
        put(base, "created_by_team_name", p.created_by_team_name);
        put(base, "created_date", p.created_date);
        put(base, "ir", p.ir);
        put(base, "forms", p.forms);
        put(base, "last_updated_at", p.last_updated_at);
        put(base, "updated_description", p.updated_description);
        put(base, "updated_by_name", p.updated_by_name);
        put(base, "updated_status", p.updated_status);
        put(base, "updated_date_raw", p.updated_date_raw);
        put(base, "location_reference", p.location_reference);
        put(base, "classification", p.classification);
        put(base, "podium_area", p.podium_area);
        put(base, "building", p.building);
        put(base, "room", p.room);
        put(base, "room_group", p.room_group);
        put(base, "level_name", p.level_name);
        put(base, "review_flag", p.review_flag);
        put(base, "rectified_status", deriveRectifiedStatus(p.status_raw, base));
        put(base, "closure_status", deriveClosureStatus(p.status_raw));
        if (!skipPriority) put(base, "priority", p.priority);

        // Re-import 확장 필드
        if (p.extra) {
          for (const [k, v] of Object.entries(p.extra)) {
            // team은 위 pickTeam에서 이미 결정되었으므로 여기서 덮어쓰지 않는다.
            if (k === "team") continue;
            if (k === "hdec_verification" && skipVerification) continue;
            put(base, k, v);
          }
        }
        // ── 자동 채움 rule: room_group (location_raw 조회+규칙, AI 토글 ON 일 때만) ──
        // 우선순위: 엑셀 원본값 → 기존 DB값 → 조회표(496키) → 규칙 10개 → BOH
        // Reference 가 두 값으로 갈리는 8키는 채우지 않는다.
        if (f.aiClassifyEnabled && !base.room_group && !prev?.room_group && !excludedFields.has("room_group")) {
          const rg = resolveRoomGroup((base.location_raw ?? p.location_raw ?? null) as string | null);
          if (rg) {
            base.room_group = rg;
            roomGroupAutoFilled += 1;
          }
        }
        // ── 자동 채움 rule: Subcon ──
        // HDEC PIC/ENG 자동 채움은 2026-08-04 폐지(규칙 매칭 0건 · 담당 오염 위험).
        // 원본 엑셀 값(base 에 이미 있음) 또는 기존 DB 값이 있으면 skip.
        {
          const planGroupVal = (base.plan_group ?? p.plan_group ?? null) as string | null;
          const roomGroupVal = (base.room_group ?? p.room_group ?? null) as string | null;
          const plot = resolvePlotFromPlanGroup(planGroupVal);
          if (plot) {
            // Subcon
            if (
              !base.subcontractor_name &&
              !prev?.subcontractor_name &&
              !excludedFields.has("subcontractor_name")
            ) {
              const mainTradeVal = (base.main_trade ?? null) as string | null;
              const subTradeVal = (base.sub_trade ?? null) as string | null;
              const descVal = (base.description ?? p.description ?? null) as string | null;
              const sub = resolveSubcon(
                subconRules,
                plot,
                planGroupVal,
                roomGroupVal,
                mainTradeVal,
                subTradeVal,
                descVal,
              );
              if (sub) base.subcontractor_name = sub;
            }
          }
        }
        // ── Status 전이 기반 Actual Date 자동 채움 ────────────────────────────
        // last_updated_at (없으면 data_date) 을 fallback 날짜로 사용.
        const transitionDate =
          (p.last_updated_at ? String(p.last_updated_at).slice(0, 10) : null) ?? dataDate ?? null;
        const newRS = base.rectified_status as string | undefined;
        const newCS = base.closure_status as string | undefined;
        const prevRS = prev?.rectified_status ?? null;
        const prevCS = prev?.closure_status ?? null;
        const fileHasActualStart = !!base.actual_start_date;
        const fileHasActualRect = !!base.actual_rectified_date;
        const fileHasActualClose = !!base.actual_closure_date;

        if (transitionDate) {
          // Closed 진입: closure/rectified/start 모두 없으면 채움 + rectified_status 강제
          if (
            newCS === "Closed" &&
            prevCS !== "Closed"
          ) {
            if (
              !excludedFields.has("actual_closure_date") &&
              !fileHasActualClose &&
              !prev?.actual_closure_date
            ) {
              base.actual_closure_date = transitionDate;
            }
            if (
              !excludedFields.has("actual_rectified_date") &&
              !fileHasActualRect &&
              !prev?.actual_rectified_date
            ) {
              base.actual_rectified_date = transitionDate;
            }
            // Closed는 Rectified 후행이므로 rectified_status 강제
            if (!excludedFields.has("rectified_status")) {
              base.rectified_status = "Rectified";
            }
          }
          // Rectified 진입 (Closed가 아닌 경우에만 별도 처리; Closed는 위에서 커버)
          else if (
            newRS === "Rectified" &&
            prevRS !== "Rectified"
          ) {
            if (
              !excludedFields.has("actual_rectified_date") &&
              !fileHasActualRect &&
              !prev?.actual_rectified_date
            ) {
              base.actual_rectified_date = transitionDate;
            }
            if (
              !excludedFields.has("actual_start_date") &&
              !fileHasActualStart &&
              !prev?.actual_start_date
            ) {
              base.actual_start_date = transitionDate;
            }
          }
          // In Progress 진입: start만 채움
          else if (
            newRS === "In Progress" &&
            prevRS !== "In Progress"
          ) {
            if (
              !excludedFields.has("actual_start_date") &&
              !fileHasActualStart &&
              !prev?.actual_start_date
            ) {
              base.actual_start_date = transitionDate;
            }
          }
        }
        // closure_status = 'Closed' 이면 rectified_status는 항상 Rectified 로 강제 (인과)
        if (base.closure_status === "Closed" && !excludedFields.has("rectified_status")) {
          base.rectified_status = "Rectified";
        }
        return base;
      });

      // ============ 규칙 기반 자동 분류 (인라인, LLM 은 임포트 후 백그라운드) ============
      // 4개 필드 중 "빈 필드" 만 대상. 규칙으로 매칭되는 것만 즉시 채우고,
      // 규칙 미매칭 필드는 그대로 두어 임포트 후 서버 측 bulkClassifyDefects 가 LLM 으로 채움.
      // 사유: 39k행 × LLM 배치를 인라인으로 돌리면 upsert 가 시작되기 전에 수 분간 블로킹.
      const rowsNeedingBackgroundClassify: string[] = [];
      let classificationResult: DefectImportFile["classificationResult"] = {
        skippedRows: 0,
        ruleOnlyRows: 0,
        llmRows: 0,
        llmUpdated: 0,
        llmFailed: 0,
      };
      try {
        const t0 = performance.now();
        const classifyQueue: ClassifyRequestItem[] = [];
        const targetsByKey = new Map<string, string[]>();
        for (let i = 0; i < workingRows.length; i++) {
          const p = workingRows[i];
          const base = payloads[i];
          const incoming = {
            defect_location: (base.defect_location as string | null | undefined) ?? p.defect_location ?? null,
            main_trade: (base.main_trade as string | null | undefined) ?? (p.extra?.main_trade as string | undefined) ?? null,
            sub_trade: (base.sub_trade as string | null | undefined) ?? (p.extra?.sub_trade as string | undefined) ?? null,
            work_type: (base.work_type as string | null | undefined) ?? (p.extra?.work_type as string | undefined) ?? null,
          };
          const prev = existing.get(p.source_issue_no);
          const targets = computeTargets(incoming, prev);
          if (targets.length === 0) continue;
          targetsByKey.set(p.source_issue_no, targets);
          classifyQueue.push({
            source_issue_no: p.source_issue_no,
            category: p.category,
            type: p.defect_type,
            item: p.item,
            description: p.description,
            targets,
          });
        }

        if (classifyQueue.length > 0) {
          const { ruleResults, needsLlm } = runRuleStage(classifyQueue);
          // 규칙 결과만 payload 에 반영 (매칭된 필드만). 규칙 미매칭 필드는 null 유지.
          const payloadByKey = new Map<string, Record<string, unknown>>();
          for (let i = 0; i < workingRows.length; i++) {
            payloadByKey.set(workingRows[i].source_issue_no, payloads[i]);
          }
          for (const [key, rr] of ruleResults) {
            const pl = payloadByKey.get(key);
            if (!pl) continue;
            for (const [k, v] of Object.entries(rr)) {
              if (v == null) continue;
              put(pl, k, v);
            }
          }
          // 규칙으로 못 채운 필드가 남은 행은 임포트 후 백그라운드 LLM 분류 대상
          if (f.aiClassifyEnabled) {
            for (const it of needsLlm) rowsNeedingBackgroundClassify.push(it.source_issue_no);
          }
          const ms = Math.round(performance.now() - t0);
          const skippedRows = workingRows.length - classifyQueue.length;
          const ruleOnlyRows = classifyQueue.length - needsLlm.length;
          classificationResult = {
            skippedRows,
            ruleOnlyRows,
            llmRows: f.aiClassifyEnabled ? needsLlm.length : 0,
            llmUpdated: 0,
            llmFailed: 0,
          };
          console.log(
            `[defect-import] 규칙 분류 완료 total=${workingRows.length} 스킵=${skippedRows} 규칙매칭=${ruleOnlyRows} LLM대기=${f.aiClassifyEnabled ? needsLlm.length : 0}(AI=${f.aiClassifyEnabled ? "ON" : "OFF"}) ${ms}ms`,
          );
        } else {
          classificationResult = {
            skippedRows: workingRows.length,
            ruleOnlyRows: 0,
            llmRows: 0,
            llmUpdated: 0,
            llmFailed: 0,
          };
        }
      } catch (err) {
        console.warn("[defect-import] 규칙 분류 실패 (임포트는 계속)", err);
      }
      // ============ /규칙 기반 자동 분류 ============

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;
      let skippedLocked = 0;
      const importErrors: DefectImportError[] = [];
      // 행별 rejection 사유 맵 — row_logs에 정확히 반영하기 위함.
      // 키: source_issue_no (문자열). preflight/batch 실패 시 채워짐.
      const rejectedByKey = new Map<string, { reason_code: string; reason_detail?: string }>();
      let lastProgressAt = 0;
      let lastProgressPct = -1;

      try {
        // ── 프리플라이트: team NOT NULL 검증 ─────────────────────────────
        // Category/Team 컬럼이 선택에서 제외되면 pickTeam이 null을 반환하여
        // DB에서 23502로 전량 거부된다. 배치를 보내기 전에 미리 필터링하여
        // 무의미한 왕복(수백~수천 회)을 차단한다.
        const teamNullCount = payloads.filter((p) => p.team == null).length;
        if (teamNullCount > 0) {
          const validPayloads = payloads.filter((p) => p.team != null);
          const invalidPayloads = payloads.filter((p) => p.team == null);
          rejected += invalidPayloads.length;
          for (const inv of invalidPayloads) {
            const key = String(inv.source_issue_no ?? "");
            if (key) {
              rejectedByKey.set(key, {
                reason_code: "PREFLIGHT_TEAM_NULL",
                reason_detail: "Category/Team 컬럼이 제외되었거나 매핑되지 않았습니다.",
              });
            }
          }
          const sample = invalidPayloads[0]?.source_issue_no as string | undefined;
          importErrors.push({
            batch: -1,
            message: `${invalidPayloads.length}건 팀(team) 미결정 — Category/Team 컬럼이 제외되었거나 매핑되지 않았습니다. 컬럼 선택에서 Category 헤더를 포함해 재시도하세요.`,
            code: "PREFLIGHT_TEAM_NULL",
            sampleId: sample,
          });
          console.warn(
            `[defect-import] 프리플라이트: team=null 행 ${invalidPayloads.length}건 제외 (전체 ${payloads.length})`,
          );
          payloads.length = 0;
          payloads.push(...validPayloads);
          if (payloads.length === 0) {
            throw new Error(
              "선택한 컬럼만으로는 팀(Team)을 결정할 수 없습니다. 컬럼 선택 다이얼로그에서 Category(또는 Team) 컬럼을 포함하여 다시 시도해 주세요.",
            );
          }
        }

        // 배치 슬라이스 준비
        const importStartedAt = performance.now();
        console.log(
          `[defect-import] "${f.name}" 시작 rows=${payloads.length} batches=${Math.ceil(payloads.length / INSERT_CHUNK)} concurrency=${BATCH_CONCURRENCY}`,
        );
        const slices: Array<{ rows: Record<string, unknown>[]; batchIndex: number }> = [];
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
          slices.push({
            rows: payloads.slice(i, i + INSERT_CHUNK),
            batchIndex: Math.floor(i / INSERT_CHUNK),
          });
        }

        await runWithConcurrency(slices, BATCH_CONCURRENCY, async ({ rows: slice, batchIndex }) => {
          if (cancelRequestedRef.current) return;
          const batchStart = performance.now();
          const { error } = await upsertBatch(slice);
          let successRows: Array<Record<string, unknown>> = [];
          let failRows: Array<Record<string, unknown>> = [];

          if (!error) {
            successRows = slice;
          } else {
            // 데이터 오류 또는 문장 타임아웃 → 이분 탐색으로 작은 배치 재시도 & 성공/실패 분리
            console.error("[defect-import] batch upsert error, splitting", {
              batchIndex,
              transient: isNetworkError(error) || isStatementTimeout(error),
              error,
            });
            importErrors.push({
              batch: batchIndex,
              message: error.message,
              code: (error as any).code,
              details: (error as any).details,
              hint: (error as any).hint,
              sampleId: slice[0]?.source_issue_no as string,
            });
            const split = await upsertWithBinarySplit(slice, batchIndex);
            successRows = slice.filter((r) => (r as any).__ok);
            failRows = split.rejectedRows;
            for (const row of successRows) delete (row as any).__ok;
            importErrors.push(...split.rowErrors);
            for (const row of failRows) {
              const key = String((row as any).source_issue_no ?? "");
              if (key) {
                rejectedByKey.set(key, {
                  reason_code: (error as any).code || "UPSERT_FAILED",
                  reason_detail: (error as any).details || error.message,
                });
              }
            }
          }

          for (const row of successRows) {
            if (existing.has(row.source_issue_no as string)) updated++;
            else inserted++;
          }
          rejected += failRows.length;
          for (const row of slice) {
            if (existing.get(row.source_issue_no as string)?.priority_locked) skippedLocked++;
          }
          processed += slice.length;
          const pct = Math.round((processed / Math.max(payloads.length, 1)) * 100);
          const now = Date.now();
          if (pct !== lastProgressPct && (pct === 100 || now - lastProgressAt >= PROGRESS_UPDATE_MS)) {
            lastProgressAt = now;
            lastProgressPct = pct;
            setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: pct } : x)));
          }
          const batchMs = Math.round(performance.now() - batchStart);
          console.log(`[defect-import] batch ${batchIndex} rows=${slice.length} ${batchMs}ms`);
        });
        const upsertMs = Math.round(performance.now() - importStartedAt);
        console.log(`[defect-import] "${f.name}" upsert 완료 총 ${upsertMs}ms (rows=${payloads.length}, ${Math.round(payloads.length / (upsertMs / 1000 || 1))} rows/s)`);

        // per-row logs — 사용자 응답성 확보를 위해 백그라운드로 병렬 삽입 (실패 시 콘솔 경고)
        if (logId) {
          const rowLogRows = workingRows.map((p) => {
            const rej = rejectedByKey.get(String(p.source_issue_no ?? ""));
            const action = rej
              ? "rejected"
              : existing.has(p.source_issue_no)
                ? "updated"
                : "inserted";
            return {
              upload_id: logId,
              raw_row_no: p.rawRowNo,
              team: pickTeam(p),
              source_issue_no: p.source_issue_no,
              action_taken: action,
              reason_code: rej?.reason_code ?? null,
              reason_detail: rej?.reason_detail ?? null,
            };
          });
          const rowLogChunks: typeof rowLogRows[] = [];
          for (let i = 0; i < rowLogRows.length; i += ROW_LOG_CHUNK) {
            rowLogChunks.push(rowLogRows.slice(i, i + ROW_LOG_CHUNK));
          }
          void runWithConcurrency(rowLogChunks, BATCH_CONCURRENCY, async (chunk) => {
            const { error } = await (supabase as any)
              .from("defect_import_row_logs")
              .insert(chunk);
            if (error) console.warn("[defect-import] row-log insert failed", error);
          });

          // Field-level logs
          try {
            const SM_TRACKED_FIELDS = [
              // identity / status
              "team","status_raw","priority","hdec_verification","hdec_reason",
              // content
              "category","defect_type","item","description",
              // location
              "area_type","area_level","area_location","defect_location","room_group",
              // trade / people
              "main_trade","sub_trade","work_type",
              "hdec_pic_name","hdec_eng_name","subcontractor_name","subsub_name",
              // dates / progress
              "due_by","planned_start_date","actual_start_date",
              "planned_rectified_date","actual_rectified_date","rectified_status",
              "planned_closure_date","actual_closure_date","closure_status",
              "planned_progress_pct","actual_progress_pct","updated_status",
            ] as const;
            const payloadByKey2 = new Map<string, any>();
            for (let i = 0; i < workingRows.length; i++) {
              payloadByKey2.set(workingRows[i].source_issue_no, payloads[i]);
            }
            // 이번 임포트에서 사용자가 제외한 필드는 값 자체가 payload 에 실리지 않으므로,
            // 매 행마다 previous 와 비교해봤자 모두 `unchanged` 로 판정되어 수십만 건의
            // import_field_logs 를 만든다. 큰 임포트에서 이 부분이 UI 를 수 분간 정지시키는
            // 원인이므로, 제외 필드는 아예 순회에서 뺀다.
            const trackedFieldsForFile = SM_TRACKED_FIELDS.filter(
              (fname) => !excludedFields.has(fname),
            );
            const pendingFieldLogs: PendingFieldLog[] = [];
            workingRows.forEach((p) => {
              const key = String(p.source_issue_no ?? "");
              const rej = rejectedByKey.get(key);
              if (rej) {
                pendingFieldLogs.push(
                  buildFieldLog("defect", {
                    rawRowNo: p.rawRowNo ?? null,
                    field: "__row__",
                    outcome: "rejected_invalid",
                    raw: key,
                    code: rej.reason_code,
                    detail: rej.reason_detail ?? null,
                  }),
                );
                return;
              }
              // priority_locked 로 인해 실질 스킵된 행: __row__ / skipped_clear_blocked
              if (existing.get(p.source_issue_no as string)?.priority_locked) {
                pendingFieldLogs.push(
                  buildFieldLog("defect", {
                    rawRowNo: p.rawRowNo ?? null,
                    field: "__row__",
                    outcome: "skipped_clear_blocked",
                    raw: key,
                    code: "priority_locked",
                    detail: "우선순위 잠금으로 인해 값 변경이 차단되었습니다.",
                  }),
                );
              }
              const prior = existing.get(p.source_issue_no) ?? ({} as any);
              const wasExisting = existing.has(p.source_issue_no);
              const applied = payloadByKey2.get(p.source_issue_no) ?? {};
              for (const fname of trackedFieldsForFile) {
                const incoming = (applied as any)[fname] ?? null;
                const previous = (prior as any)[fname] ?? null;
                const cls = classifyChange(incoming, previous);
                // `unchanged` / `empty` 는 감사 가치가 없고 볼륨만 폭증시키므로 저장 생략.
                if (cls !== "applied") continue;
                pendingFieldLogs.push(
                  buildFieldLog("defect", {
                    rawRowNo: p.rawRowNo ?? null,
                    field: fname,
                    outcome: "applied",
                    raw: incoming,
                    applied: incoming,
                    previous: wasExisting ? previous : null,
                  }),
                );
              }
            });
            // 사용자 체감 응답성을 위해 백그라운드로 전송. 실패해도 임포트 결과에는 영향 없음.
            void flushFieldLogs(supabase, logId, userId, pendingFieldLogs).catch((e) =>
              console.warn("[defect-import] field-log flush failed", e),
            );
          } catch (e) {
            console.warn("[defect-import] field-log insert failed", e);
          }
        }

        const finalStatus =
          rejected === 0 && importErrors.length === 0
            ? "success"
            : inserted + updated === 0
              ? "failed"
              : "partial";

        if (logId) {
          await (supabase as any)
            .from("defect_import_logs")
            .update({
              status: finalStatus,
              inserted,
              updated,
              skipped: skippedLocked + skippedReimportNoMatch,
              rejected,
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
                    skippedLocked,
                    rejected,
                    duplicates,
                    skippedReimportNoMatch,
                    unmappedCategoryCount: Array.from(unmappedCategories.values()).reduce((a, b) => a + b, 0),
                    unmappedCategories: Array.from(unmappedCategories.entries()).map(([c, n]) => `${c} × ${n}`),
                    errors: importErrors.length ? importErrors : undefined,
                  },
                  classificationResult,
                }
              : x,
          ),
        );
        if (rejected > 0) toast.warning(`${f.name}: ${rejected}행 rejected. 콘솔 확인.`);
        if (skippedReimportNoMatch > 0)
          toast.info(
            `${f.name}: Re-import 매칭 실패 ${skippedReimportNoMatch}행 건너뜀 (신규 생성 안 함).`,
          );

        // 백그라운드 LLM 분류 트리거 (임포트 완료 후, UI 는 이미 반환)
        if (finalStatus !== "failed" && rowsNeedingBackgroundClassify.length > 0) {
          void (async () => {
            try {
              // source_issue_no → id 조회
              const idsToClassify: string[] = [];
              const KEY_CHUNK = 500;
              for (let i = 0; i < rowsNeedingBackgroundClassify.length; i += KEY_CHUNK) {
                const keys = rowsNeedingBackgroundClassify.slice(i, i + KEY_CHUNK);
                const { data } = await (supabase as any)
                  .from("defect_items_raw")
                  .select("id")
                  .in("source_issue_no", keys);
                for (const r of (data ?? []) as Array<{ id: string }>) {
                  idsToClassify.push(r.id);
                }
              }
              if (idsToClassify.length === 0) return;
              const CLASSIFY_CHUNK = 2000;
              let totalUpdated = 0;
              let totalFailed = 0;
              for (let i = 0; i < idsToClassify.length; i += CLASSIFY_CHUNK) {
                const chunk = idsToClassify.slice(i, i + CLASSIFY_CHUNK);
                try {
                  const res = await bulkClassifyDefects({ data: { ids: chunk } });
                  totalUpdated += (res as any).updated ?? 0;
                  totalFailed += (res as any).failed ?? 0;
                } catch (err) {
                  console.warn("[defect-import] background classify chunk failed", err);
                  totalFailed += chunk.length;
                }
              }
              try { qc.invalidateQueries({ queryKey: ["defect"] }); } catch { /* ignore */ }
              setFiles((cur) =>
                cur.map((x) =>
                  x.id === f.id
                    ? {
                        ...x,
                        classificationResult: {
                          ...(x.classificationResult ?? {
                            skippedRows: 0,
                            ruleOnlyRows: 0,
                            llmRows: idsToClassify.length,
                            llmUpdated: 0,
                            llmFailed: 0,
                          }),
                          llmUpdated: totalUpdated,
                          llmFailed: totalFailed,
                        },
                      }
                    : x,
                ),
              );
            } catch (err) {
              console.warn("[defect-import] background classify failed", err);
              setFiles((cur) =>
                cur.map((x) =>
                  x.id === f.id
                    ? {
                        ...x,
                        classificationResult: {
                          ...(x.classificationResult ?? {
                            skippedRows: 0,
                            ruleOnlyRows: 0,
                            llmRows: rowsNeedingBackgroundClassify.length,
                            llmUpdated: 0,
                            llmFailed: 0,
                          }),
                          llmFailed: rowsNeedingBackgroundClassify.length,
                        },
                      }
                    : x,
                ),
              );
            }
          })();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[defect-import] fatal", e);
        if (logId) {
          await (supabase as any)
            .from("defect_import_logs")
            .update({
              status: "failed",
              errors: [{ batch: -1, message: msg }],
              finished_at: new Date().toISOString(),
            })
            .eq("id", logId);
        }
        setFiles((cur) =>
          cur.map((x) => (x.id === f.id ? { ...x, status: "failed", error: msg } : x)),
        );
      }
    }

    setIsRunning(false);
    // Defect 캐시 무효화 → status_group 재계산으로 Unclosed/Closed 탭 자동 정합
    try { qc.invalidateQueries({ queryKey: ["defect"] }); } catch { /* ignore */ }
    if (cancelRequestedRef.current) {
      toast.info("Snag List import 취소됨");
    } else {
      toast.success(`Snag List import 완료: ${ready.length} file(s)`);
    }
  }, [qc]);

  const startImport = useCallback(async () => {
    if (isRunning) return;
    const ready = files.filter(
      (f) => f.status === "ready" && !f.validationError && f.parsed && f.parsed.length > 0,
    );
    if (ready.length === 0) {
      toast.error("Import 가능한 파일이 없습니다.");
      return;
    }
    cancelRequestedRef.current = false;
    setIsCancelling(false);
    setIsRunning(true);
    try {
      await takePreImportSnapshotWithFeedback("sm");
    } catch {
      // toast 메시지는 takePreImportSnapshotWithFeedback 내부에서 처리
    }
    try {
      await executeImport(ready);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[defect-import] start failed", e);
      toast.error(`Snag List import 실패: ${msg}`);
    } finally {
      setIsRunning(false);
      cancelRequestedRef.current = false;
      setIsCancelling(false);
    }
  }, [files, isRunning, executeImport]);

  /**
   * DB의 최신 defect_header_mappings 를 다시 읽고, 이미 파싱된 파일들의
   * headerToFieldMap 만 다시 계산한다. 관리자 탭에서 매핑을 방금 수정한
   * 사용자를 위한 즉시 반영 경로. 원본 파일은 재파싱하지 않는다.
   */
  const refreshAliases = useCallback(async (): Promise<number> => {
    const extraAliases = await fetchAliases();
    const { toDefectFieldName } = await loadDefectParser();
    let aliasCount = 0;
    for (const list of Object.values(extraAliases)) aliasCount += list.length;
    setFiles((cur) =>
      cur.map((f) => {
        if (!f.availableHeaders) return f;
        const next: Record<string, string> = {};
        for (const h of f.availableHeaders) {
          next[h] = toDefectFieldName(h, extraAliases);
        }
        // resolver가 채택했던 source_issue_no 결정은 파서 결과에 이미 반영되어 있으므로
        // 기존 headerToFieldMap 에서 source_issue_no 로 지정된 헤더는 유지한다.
        for (const [h, field] of Object.entries(f.headerToFieldMap ?? {})) {
          if (field === "source_issue_no") next[h] = "source_issue_no";
        }
        return { ...f, headerToFieldMap: next };
      }),
    );
    return aliasCount;
  }, [fetchAliases]);

  return (
    <Ctx.Provider
      value={{
        files,
        isRunning,
        isCancelling,
        requestCancel,
        addFiles,
        removeFile,
        clearAll,
        setFileDataDateOverride,
        setFileSheet,
        setFileExcludedHeaders,
        setFileDateOverrides,
        setFileDuplicateStrategy,
        setFileDuplicateSelection,
        resolveDuplicates,
        startImport,
        setFileAiClassifyEnabled,
        setFileParsedRows,
        setFileMasterMappingNote,
        refreshAliases,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
