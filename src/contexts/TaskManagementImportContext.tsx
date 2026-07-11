import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  parseTaskManagementExcel,
  type ParsedTaskRow,
} from "@/lib/task-management/parser";
import type { Discipline } from "@/lib/task-management/columns";
import { runRollupAllParents, runRecalcAutoJudgment } from "@/lib/task-management/rollup.functions";

export type RollupMode = "auto" | "keep" | "blank";

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
  parentCount?: number;
  childCount?: number;
  warnings?: string[];
  sheetName?: string;
  discipline?: Discipline;
  disciplineHint?: Discipline | null;
  validationError?: string | null;
  error?: string;
  result?: {
    inserted: number;
    updated: number;
    skipped: number;
    rejected: number;
    duplicates?: number;
    rolledUp?: number;
    judgmentRecalculated?: number;
    errors?: ImportErrorEntry[];
  };
}

interface CtxValue {
  files: TmImportFileItem[];
  isRunning: boolean;
  rollupMode: RollupMode;
  setRollupMode: (m: RollupMode) => void;
  recalcJudgment: boolean;
  setRecalcJudgment: (v: boolean) => void;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  setFileDiscipline: (id: string, d: Discipline) => void;
  startImport: () => Promise<void>;
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
  const [isRunning, setIsRunning] = useState(false);
  const [rollupMode, setRollupMode] = useState<RollupMode>("auto");
  const [recalcJudgment, setRecalcJudgment] = useState<boolean>(true);

  const addFiles = useCallback(async (selected: File[]) => {
    const excel = selected.filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    const next: TmImportFileItem[] = excel.map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      name: file.name,
      size: file.size,
      status: "parsing",
      progress: 0,
    }));
    setFiles((cur) => [...cur, ...next]);

    // Fetch active header mappings once per batch
    let extraAliases: Record<string, string[]> = {};
    try {
      const { data: mappings } = await (supabase as any)
        .from("task_management_header_mappings")
        .select("source_header, target_field, is_active")
        .eq("module", "task_management")
        .eq("is_active", true);
      for (const m of (mappings ?? []) as Array<{ source_header: string; target_field: string }>) {
        if (!m.target_field || !m.source_header) continue;
        (extraAliases[m.target_field] ||= []).push(m.source_header);
      }
    } catch {
      // ignore — fall back to canonical headers
    }

    for (const item of next) {
      try {
        const parsed = await parseTaskManagementExcel(item.file, extraAliases);
        setFiles((cur) =>
          cur.map((f) => {
            if (f.id !== item.id) return f;
            const validation =
              parsed.rows.length === 0
                ? "행을 찾지 못했습니다. 'Gantt' 시트와 헤더 위치를 확인하세요."
                : !parsed.dataDate
                  ? "C4 셀에서 Data Date를 읽지 못했습니다."
                  : null;
            return {
              ...f,
              status: "ready",
              parsed: parsed.rows,
              dataDate: parsed.dataDate,
              parentCount: parsed.parentCount,
              childCount: parsed.childCount,
              warnings: parsed.warnings,
              sheetName: parsed.sheetName,
              disciplineHint: parsed.disciplineHint,
              discipline: parsed.disciplineHint ?? "건축",
              validationError: validation,
            };
          }),
        );
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
  }, []);

  const removeFile = useCallback(
    (id: string) => setFiles((cur) => cur.filter((f) => f.id !== id)),
    [],
  );
  const clearAll = useCallback(() => setFiles([]), []);

  const setFileDiscipline = useCallback((id: string, d: Discipline) => {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, discipline: d } : f)));
  }, []);

  const executeImport = useCallback(async (ready: TmImportFileItem[]) => {
    setIsRunning(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    for (const f of ready) {
      const parsed = f.parsed ?? [];
      const discipline = f.discipline ?? "건축";
      const startTime = Date.now();
      const startedAtIso = new Date().toISOString();

      // Create log
      const { data: logRow } = await (supabase as any)
        .from("task_management_import_logs")
        .insert({
          file_name: f.name,
          discipline,
          data_date: f.dataDate ?? null,
          sheet_name: f.sheetName ?? null,
          total_rows: parsed.length,
          status: "processing",
          imported_by: userId,
          started_at: startedAtIso,
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
      for (let i = 0; i < taskNos.length; i += 500) {
        const chunk = taskNos.slice(i, i + 500);
        const { data } = await (supabase as any)
          .from("task_management_raw")
          .select("task_no")
          .eq("discipline", discipline)
          .in("task_no", chunk);
        for (const r of data ?? []) existingSet.add(r.task_no);
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
          if (prev.level === "parent" && p.level === "child") {
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

      const payloads = deduped.map((p) => {
        const isParent = p.level === "parent";
        const stripParent = isParent && rollupMode === "auto";
        return {
        task_no: p.task_no,
        parent_task_no: p.parent_task_no,
        level: p.level,
        discipline,
        category: p.category,
        plot: p.plot,
        task_name: p.task_name,
        risk: p.risk,
        sub_task_desc: p.sub_task_desc,
        pic: p.pic,
        row_type: p.row_type,
        status_manual: p.status_manual,
        plan_start: stripParent ? null : p.plan_start,
        plan_end: stripParent ? null : p.plan_end,
        plan_days: stripParent ? null : p.plan_days,
        actual_start: p.actual_start,
        actual_progress: stripParent ? null : p.actual_progress,
        plan_progress: stripParent ? null : p.plan_progress,
        progress_variance: stripParent ? null : p.progress_variance,
        forecast_end: p.forecast_end,
        slip_days: p.slip_days,
        auto_judgment: null as string | null,
        auto_judgment_import: p.auto_judgment,
        data_date: f.dataDate,
        sort_order: p.sort_order,
        source_file: f.name,
        imported_at: startedAtIso,
        imported_by: userId,
        };
      });

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;
      const importErrors: ImportErrorEntry[] = [];

      try {
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
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
                importErrors.push({
                  batch: batchIndex,
                  message: r.error.message,
                  code: r.error.code,
                  details: r.error.details,
                  hint: r.error.hint,
                  sampleTaskNo: row.task_no,
                });
              } else {
                recovered++;
                if (existingSet.has(row.task_no)) updated++;
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
          const newTaskNos = deduped
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
            const rowLogRows = deduped.map((p, idx) => ({
              upload_id: logId,
              raw_row_no: idx + 1,
              discipline,
              task_no: p.task_no,
              action_taken: existingSet.has(p.task_no) ? "updated" : "inserted",
            }));
            for (let i = 0; i < rowLogRows.length; i += 500) {
              await (supabase as any)
                .from("task_management_import_row_logs")
                .insert(rowLogRows.slice(i, i + 500));
            }
          } catch (e) {
            console.warn("[task-import] row-log insert failed", e);
          }
        }

        // Post-import: rollup + judgment recalc
        let rolledUp = 0;
        let judgmentRecalculated = 0;
        try {
          if (rollupMode !== "keep") {
            const res = await runRollupAllParents({
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

        const finalStatus =
          rejected === 0 && importErrors.length === 0
            ? "success"
            : inserted + updated === 0
              ? "failed"
              : "partial";

        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
            .update({
              status: finalStatus,
              inserted,
              updated,
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
                    skipped: 0,
                    rejected,
                    duplicates,
                    rolledUp,
                    judgmentRecalculated,
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
        console.error("[task-import] fatal", e);
        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
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

      void startTime;
    }

    setIsRunning(false);
    toast.success(`Task Management import 완료: ${ready.length} file(s)`);
  }, [rollupMode, recalcJudgment]);

  const startImport = useCallback(async () => {
    if (isRunning) return;
    const ready = files.filter(
      (f) => f.status === "ready" && f.parsed && f.parsed.length > 0 && !f.validationError,
    );
    if (ready.length === 0) {
      toast.error("Import 가능한 파일이 없습니다");
      return;
    }
    await executeImport(ready);
  }, [files, isRunning, executeImport]);

  return (
    <Ctx.Provider
      value={{
        files,
        isRunning,
        rollupMode,
        setRollupMode,
        recalcJudgment,
        setRecalcJudgment,
        addFiles,
        removeFile,
        clearAll,
        setFileDiscipline,
        startImport,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}