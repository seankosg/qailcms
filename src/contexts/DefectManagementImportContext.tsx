import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  getDefectExcelSheetNames,
  getDefectExcelHeaders,
  parseDefectExcel,
  type DefectSheetHeader,
  type DefectTargetField,
  type ParsedDefectRow,
} from "@/lib/defect-management/parser";
import { deriveCompletionStatus, deriveClosureStatus } from "@/lib/defect-management/derived";
import type { DefectTeam } from "@/lib/defect-management/columns";
import { DEFECT_TEAMS } from "@/lib/defect-management/columns";

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
  duplicateStrategy?: DuplicateStrategy;
  duplicateGroups?: DuplicateGroup[];
  autoDedupedIdenticalCount?: number;
}

interface CtxValue {
  files: DefectImportFile[];
  isRunning: boolean;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  setFileDataDateOverride: (id: string, date: string | null) => void;
  setFileSheet: (id: string, sheetName: string) => Promise<void>;
  setFileExcludedHeaders: (id: string, excluded: string[]) => Promise<void>;
  setFileDuplicateStrategy: (id: string, strategy: DuplicateStrategy) => void;
  setFileDuplicateSelection: (id: string, groupKey: string, parsedIndex: number) => void;
  resolveDuplicates: (id: string) => void;
  startImport: () => Promise<void>;
}

const Ctx = createContext<CtxValue | null>(null);

export function useDefectImport() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDefectImport must be used within provider");
  return c;
}

const INSERT_CHUNK = 150;
const BATCH_DELAY_MS = 60;
const RETRY_DELAYS_MS = [300, 800, 2000];

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

function validate(f: DefectImportFile): string | null {
  if (!f.parsed || f.parsed.length === 0) return "행을 찾지 못했습니다.";
  if ((f.duplicateGroups?.length ?? 0) > 0) {
    return `동일 Issue No 중복이 ${f.duplicateGroups!.length}그룹 감지되었습니다. "중복 검토"를 완료하세요.`;
  }
  return null;
}

export function DefectManagementImportProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<DefectImportFile[]>([]);
  const [isRunning, setIsRunning] = useState(false);

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

  /** file.file을 실제로 파싱하고 결과로 파일 상태를 업데이트. */
  const parseAndApply = useCallback(
    async (id: string, file: File, sheetName?: string, excludedHeaders?: string[]) => {
      const extraAliases = await fetchAliases();
      try {
        const parsed = await parseDefectExcel(file, {
          extraAliases,
          sheetName,
          excludedHeaders,
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
    }));
    setFiles((cur) => [...cur, ...next]);

    for (const item of next) {
      try {
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

  const setFileDataDateOverride = useCallback((id: string, date: string | null) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, dataDateOverride: date } : f)));
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

    for (const f of ready) {
      const parsed = f.parsed ?? [];
      const dataDate = f.dataDateOverride ?? new Date().toISOString().slice(0, 10);
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

      // 기존 행 조회 (id + lock flags)
      const ids = deduped.map((p) => p.source_issue_no);
      const existing = new Map<
        string,
        { priority_locked: boolean; hdec_verification_locked: boolean }
      >();
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data } = await (supabase as any)
          .from("defect_items_raw")
          .select("source_issue_no, priority_locked, hdec_verification_locked")
          .in("source_issue_no", chunk);
        for (const r of (data ?? []) as any[]) {
          existing.set(r.source_issue_no, {
            priority_locked: !!r.priority_locked,
            hdec_verification_locked: !!r.hdec_verification_locked,
          });
        }
      }

      // Re-import: 기존 매칭 실패한 행은 건너뜀
      const skippedReimportNoMatch = isReimport
        ? deduped.filter((p) => !existing.has(p.source_issue_no)).length
        : 0;
      const workingRows = isReimport
        ? deduped.filter((p) => existing.has(p.source_issue_no))
        : deduped;

      /** 필드가 excludedFields에 있으면 payload에서 제외 (기존 DB 값 보존). */
      const put = (base: Record<string, unknown>, field: string, value: unknown) => {
        if (excludedFields.has(field)) return;
        base[field] = value;
      };

      const unmappedCategories = new Map<string, number>();
      const payloads = workingRows.map((p) => {
        const prev = existing.get(p.source_issue_no);
        const skipPriority = prev?.priority_locked;
        const skipVerification = prev?.hdec_verification_locked;
        const rowTeam = resolveTeam(p.category);
        if (p.category && !rowTeam) {
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
        put(base, "completion_status", deriveCompletionStatus(p.status_raw));
        put(base, "closure_status", deriveClosureStatus(p.status_raw));
        if (!skipPriority) put(base, "priority", p.priority);

        // Re-import 확장 필드
        if (p.extra) {
          for (const [k, v] of Object.entries(p.extra)) {
            if (k === "hdec_verification" && skipVerification) continue;
            put(base, k, v);
          }
        }
        return base;
      });

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;
      let skippedLocked = 0;
      const importErrors: DefectImportError[] = [];

      try {
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
          const slice = payloads.slice(i, i + INSERT_CHUNK);
          const batchIndex = Math.floor(i / INSERT_CHUNK);

          // 재시도 가능한 배치 upsert. 응답 payload 축소를 위해 .select() 제거.
          let error: any = null;
          for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
            const res = await (supabase as any)
              .from("defect_items_raw")
              .upsert(slice, { onConflict: "source_issue_no" });
            error = res.error;
            if (!error) break;
            if (!isNetworkError(error)) break;
            if (attempt < RETRY_DELAYS_MS.length) {
              await sleep(RETRY_DELAYS_MS[attempt]);
              continue;
            }
          }

          if (error) {
            console.error("[defect-import] batch upsert error", { batchIndex, error });
            importErrors.push({
              batch: batchIndex,
              message: error.message,
              code: (error as any).code,
              details: (error as any).details,
              hint: (error as any).hint,
              sampleId: slice[0]?.source_issue_no as string,
            });
            for (const row of slice) {
              let r = await (supabase as any)
                .from("defect_items_raw")
                .upsert([row], { onConflict: "source_issue_no" });
              if (r.error && isNetworkError(r.error)) {
                await sleep(500);
                r = await (supabase as any)
                  .from("defect_items_raw")
                  .upsert([row], { onConflict: "source_issue_no" });
              }
              if (r.error) {
                rejected++;
                importErrors.push({
                  batch: batchIndex,
                  message: r.error.message,
                  code: r.error.code,
                  sampleId: row.source_issue_no as string,
                });
              } else if (existing.has(row.source_issue_no as string)) updated++;
              else inserted++;
            }
          } else {
            for (const row of slice) {
              if (existing.has(row.source_issue_no as string)) updated++;
              else inserted++;
            }
          }
          for (const row of slice) {
            if (existing.get(row.source_issue_no as string)?.priority_locked) skippedLocked++;
          }
          processed += slice.length;
          const pct = Math.round((processed / Math.max(payloads.length, 1)) * 100);
          setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: pct } : x)));
          if (i + INSERT_CHUNK < payloads.length) await sleep(BATCH_DELAY_MS);
        }

        // per-row logs
        if (logId) {
          try {
            const rowLogRows = workingRows.map((p) => ({
              upload_id: logId,
              raw_row_no: p.rawRowNo,
              team: resolveTeam(p.category),
              source_issue_no: p.source_issue_no,
              action_taken: existing.has(p.source_issue_no) ? "updated" : "inserted",
            }));
            for (let i = 0; i < rowLogRows.length; i += 500) {
              await (supabase as any)
                .from("defect_import_row_logs")
                .insert(rowLogRows.slice(i, i + 500));
            }
          } catch (e) {
            console.warn("[defect-import] row-log insert failed", e);
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
                }
              : x,
          ),
        );
        if (rejected > 0) toast.warning(`${f.name}: ${rejected}행 rejected. 콘솔 확인.`);
        if (skippedReimportNoMatch > 0)
          toast.info(
            `${f.name}: Re-import 매칭 실패 ${skippedReimportNoMatch}행 건너뜀 (신규 생성 안 함).`,
          );
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
    toast.success(`Defect import 완료: ${ready.length} file(s)`);
  }, []);

  const startImport = useCallback(async () => {
    if (isRunning) return;
    const ready = files.filter(
      (f) => f.status === "ready" && !f.validationError && f.parsed && f.parsed.length > 0,
    );
    if (ready.length === 0) {
      toast.error("Import 가능한 파일이 없습니다.");
      return;
    }
    await executeImport(ready);
  }, [files, isRunning, executeImport]);

  return (
    <Ctx.Provider
      value={{
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
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
