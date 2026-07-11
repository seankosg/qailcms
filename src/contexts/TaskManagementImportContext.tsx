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
  };
}

interface CtxValue {
  files: TmImportFileItem[];
  isRunning: boolean;
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

    for (const item of next) {
      try {
        const parsed = await parseTaskManagementExcel(item.file);
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

      const payloads = parsed.map((p) => ({
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
        plan_start: p.plan_start,
        plan_end: p.plan_end,
        plan_days: p.plan_days,
        actual_start: p.actual_start,
        actual_progress: p.actual_progress,
        plan_progress: p.plan_progress,
        progress_variance: p.progress_variance,
        forecast_end: p.forecast_end,
        slip_days: p.slip_days,
        auto_judgment: p.auto_judgment,
        data_date: f.dataDate,
        sort_order: p.sort_order,
        source_file: f.name,
        imported_at: startedAtIso,
        imported_by: userId,
      }));

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;

      try {
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
          const slice = payloads.slice(i, i + INSERT_CHUNK);
          const { data, error } = await (supabase as any)
            .from("task_management_raw")
            .upsert(slice, { onConflict: "discipline,task_no" })
            .select("task_no");
          if (error) {
            rejected += slice.length;
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

        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
            .update({
              status: "success",
              inserted,
              updated,
              rejected,
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
                  result: { inserted, updated, skipped: 0, rejected },
                }
              : x,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (logId) {
          await (supabase as any)
            .from("task_management_import_logs")
            .update({
              status: "failed",
              errors: { message: msg },
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
  }, []);

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