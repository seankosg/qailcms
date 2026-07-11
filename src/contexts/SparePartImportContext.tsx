import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getSparePartExcelSheetNames,
  getSparePartHeaderInfo,
  parseSparePartExcel,
  sha256Hex,
  type ParsedSparePartRow,
} from "@/lib/spare-part-import-parser";

export type FileStatus =
  | "pending"
  | "parsing"
  | "ready"
  | "processing"
  | "done"
  | "failed";

export interface ImportFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: FileStatus;
  progress: number;
  parsed?: ParsedSparePartRow[];
  parsedCount: number;
  sheetNames?: string[];
  selectedSheets?: string[];
  availableHeaders?: string[];
  headerSamples?: Record<string, unknown>;
  fieldByHeader?: Record<string, string | null>;
  excludedHeaders?: string[];
  unknownHeaders?: string[];
  emptyKeyCount?: number;
  duplicateKeyCount?: number;
  validationError?: string | null;
  error?: string;
  fileHash?: string;
  result?: {
    inserted: number;
    updated: number;
    skipped: number;
    rejected: number;
  };
}

interface CtxValue {
  files: ImportFileItem[];
  isRunning: boolean;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  setFileExcludedHeaders: (id: string, excluded: string[]) => Promise<void>;
  startImport: () => Promise<void>;
}

const Ctx = createContext<CtxValue | null>(null);

export function useSparePartImport() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSparePartImport must be used within provider");
  return c;
}

const INSERT_CHUNK = 200;

/** Load user header mappings + custom field names once per session. */
async function loadUserMap(): Promise<{
  map: Record<string, string>;
  customFields: Set<string>;
}> {
  const [{ data: hm }, { data: cf }] = await Promise.all([
    supabase.from("spare_part_header_mappings").select("source_header, target_field"),
    supabase
      .from("spare_part_custom_fields")
      .select("field_name, is_enabled")
      .eq("is_enabled", true),
  ]);
  const map: Record<string, string> = {};
  for (const r of hm ?? []) {
    if (r.source_header && r.target_field) {
      map[String(r.source_header).toLowerCase().trim()] = r.target_field;
    }
  }
  const custom = new Set<string>((cf ?? []).map((r) => r.field_name));
  return { map, customFields: custom };
}

export function SparePartImportProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<ImportFileItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUserMap()
      .then((r) => {
        setUserMap(r.map);
        setCustomFields(r.customFields);
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  const parseAndApply = useCallback(
    async (id: string, file: File, sheets?: string[], excluded?: string[]) => {
      try {
        const parsed = await parseSparePartExcel(file, sheets, {
          excludedHeaders: excluded,
          userMap,
          customFieldNames: customFields,
        });
        setFiles((cur) =>
          cur.map((f) => {
            if (f.id !== id) return f;
            const validation = parsed.rows.length === 0
              ? "No valid rows detected. Confirm the sheet contains a 'Doc Ref' column."
              : null;
            return {
              ...f,
              status: "ready",
              parsed: parsed.rows,
              parsedCount: parsed.rows.length,
              unknownHeaders: parsed.unknownHeaders,
              emptyKeyCount: parsed.emptyKeyCount,
              duplicateKeyCount: parsed.duplicateKeyCount,
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
    [userMap, customFields],
  );

  const addFiles = useCallback(
    async (selected: File[]) => {
      const excel = selected.filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f.name));
      const next: ImportFileItem[] = excel.map((file) => ({
        id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        name: file.name,
        size: file.size,
        status: "parsing",
        progress: 0,
        parsedCount: 0,
      }));
      setFiles((cur) => [...cur, ...next]);
      for (const item of next) {
        try {
          const [sheetNames, hash] = await Promise.all([
            getSparePartExcelSheetNames(item.file),
            sha256Hex(item.file),
          ]);
          let info: {
            headers: string[];
            samples: Record<string, unknown>;
            fieldByHeader: Record<string, string | null>;
          } = { headers: [], samples: {}, fieldByHeader: {} };
          try {
            info = await getSparePartHeaderInfo(item.file, sheetNames, userMap);
          } catch {
            /* non-fatal */
          }
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    sheetNames,
                    selectedSheets: sheetNames,
                    availableHeaders: info.headers,
                    headerSamples: info.samples,
                    fieldByHeader: info.fieldByHeader,
                    fileHash: hash,
                  }
                : f,
            ),
          );
          await parseAndApply(item.id, item.file, sheetNames);
        } catch (e) {
          setFiles((cur) =>
            cur.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "failed",
                    error: e instanceof Error ? e.message : "Failed to read workbook",
                  }
                : f,
            ),
          );
        }
      }
    },
    [parseAndApply, userMap],
  );

  const removeFile = useCallback(
    (id: string) => setFiles((cur) => cur.filter((f) => f.id !== id)),
    [],
  );
  const clearAll = useCallback(() => setFiles([]), []);

  const setFileExcludedHeaders = useCallback(
    async (id: string, excluded: string[]) => {
      let target: ImportFileItem | undefined;
      setFiles((cur) => {
        target = cur.find((f) => f.id === id);
        return cur.map((f) =>
          f.id === id ? { ...f, status: "parsing", excludedHeaders: excluded } : f,
        );
      });
      if (!target) return;
      await parseAndApply(id, target.file, target.selectedSheets, excluded);
    },
    [parseAndApply],
  );

  const executeImport = useCallback(async (ready: ImportFileItem[]) => {
    setIsRunning(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    for (const f of ready) {
      const parsed = f.parsed ?? [];
      const startTime = Date.now();

      // Create import log (pending).
      const { data: logRow, error: logErr } = await supabase
        .from("spare_parts_import_logs")
        .insert({
          module: "spare_part",
          file_name: f.name,
          file_hash: f.fileHash ?? null,
          file_size: f.size,
          sheet_name: f.selectedSheets?.join(", ") ?? null,
          status: "processing",
          executed_by: userId,
          source_type: "excel_import",
          unknown_headers: f.unknownHeaders ?? [],
          excluded_headers: f.excludedHeaders ?? [],
          row_counts: {
            total: parsed.length,
            inserted: 0,
            updated: 0,
            rejected: 0,
            empty_key: f.emptyKeyCount ?? 0,
            duplicate_key: f.duplicateKeyCount ?? 0,
          },
          warnings: {
            unknown_headers: f.unknownHeaders ?? [],
            excluded_headers: f.excludedHeaders ?? [],
            empty_key_count: f.emptyKeyCount ?? 0,
            duplicate_key_count: f.duplicateKeyCount ?? 0,
          },
        })
        .select("id")
        .single();

      if (logErr || !logRow) {
        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? { ...x, status: "failed", error: `Log create failed: ${logErr?.message ?? "unknown"}` }
              : x,
          ),
        );
        continue;
      }
      const logId = logRow.id;

      setFiles((cur) =>
        cur.map((x) => (x.id === f.id ? { ...x, status: "processing", progress: 0 } : x)),
      );

      let inserted = 0;
      let updated = 0;
      let rejected = 0;
      let processed = 0;

      try {
        // Fetch existing doc_refs to compute insert vs update.
        const docRefs = parsed.map((p) => p.doc_ref);
        const existingSet = new Set<string>();
        for (let i = 0; i < docRefs.length; i += 500) {
          const chunk = docRefs.slice(i, i + 500);
          const { data } = await supabase
            .from("spare_parts_raw")
            .select("doc_ref")
            .in("doc_ref", chunk);
          for (const r of data ?? []) existingSet.add(r.doc_ref);
        }

        // Build payloads.
        type Payload = { doc_ref: string; [k: string]: unknown };
        const payloads: Payload[] = parsed.map((p) => ({
          doc_ref: p.doc_ref,
          plot: p.plot,
          ...p.struct,
          raw_payload: p.raw_payload,
          custom_payload: p.custom_payload,
          updated_by: userId,
          is_active: true,
          imported_at: new Date().toISOString(),
        }));

        // Bulk upsert in chunks.
        for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
          const slice = payloads.slice(i, i + INSERT_CHUNK);
          const { data, error } = await supabase
            .from("spare_parts_raw")
            .upsert(slice as never, { onConflict: "doc_ref" })
            .select("doc_ref");
          if (error) {
            // Row-by-row fallback.
            for (const p of slice) {
              const { error: e2 } = await supabase
                .from("spare_parts_raw")
                .upsert(p as never, { onConflict: "doc_ref" });
              if (e2) rejected++;
              else if (existingSet.has(p.doc_ref)) updated++;
              else inserted++;
            }
          } else {
            for (const r of data ?? []) {
              if (existingSet.has(r.doc_ref)) updated++;
              else inserted++;
            }
          }
          processed += slice.length;
          const pct = Math.round((processed / Math.max(payloads.length, 1)) * 100);
          setFiles((cur) =>
            cur.map((x) => (x.id === f.id ? { ...x, progress: pct } : x)),
          );
        }

        await supabase
          .from("spare_parts_import_logs")
          .update({
            status: "success",
            row_counts: {
              total: parsed.length,
              inserted,
              updated,
              rejected,
              empty_key: f.emptyKeyCount ?? 0,
              duplicate_key: f.duplicateKeyCount ?? 0,
            },
            duration_ms: Date.now() - startTime,
          })
          .eq("id", logId);

        // ---- Status History diff-append ---------------------------------
        // For issue_technical / issue_supplier / issue_internal fields, add a
        // new history comment whenever the file's value differs from any
        // existing comment already recorded for that (doc_ref, category).
        try {
          const normalize = (s: unknown) =>
            typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
          const categories: Array<"technical" | "supplier" | "internal"> = [
            "technical",
            "supplier",
            "internal",
          ];
          const docRefs = parsed.map((p) => p.doc_ref);
          const existing = new Map<string, Set<string>>(); // key `${docRef}|${category}` -> set of normalized messages
          for (let i = 0; i < docRefs.length; i += 500) {
            const chunk = docRefs.slice(i, i + 500);
            const { data } = await (supabase as any)
              .from("spare_part_status_history")
              .select("doc_ref, category, message")
              .in("doc_ref", chunk)
              .in("category", ["technical", "supplier", "internal"]);
            for (const r of (data ?? []) as any[]) {
              const k = `${r.doc_ref}|${r.category}`;
              const set = existing.get(k) ?? new Set<string>();
              set.add(normalize(r.message));
              existing.set(k, set);
            }
          }
          const inserts: Array<{
            doc_ref: string;
            category: string;
            message: string;
            source: string;
            source_file_hash: string | null;
            author_user_id: string | null;
          }> = [];
          for (const p of parsed) {
            for (const category of categories) {
              const raw = (p as any)?.issues?.[category];
              const norm = normalize(raw);
              if (!norm) continue;
              const k = `${p.doc_ref}|${category}`;
              const set = existing.get(k) ?? new Set<string>();
              if (set.has(norm)) continue;
              inserts.push({
                doc_ref: p.doc_ref,
                category,
                message: String(raw).trim(),
                source: "excel_import",
                source_file_hash: f.fileHash ?? null,
                author_user_id: userId,
              });
              set.add(norm);
              existing.set(k, set);
            }
          }
          let historyAdded = 0;
          if (inserts.length > 0) {
            for (let i = 0; i < inserts.length; i += 200) {
              const slice = inserts.slice(i, i + 200);
              const { data: ins, error: insErr } = await (supabase as any)
                .from("spare_part_status_history")
                .insert(slice)
                .select("id");
              if (!insErr) historyAdded += ins?.length ?? 0;
            }
          }
          if (historyAdded > 0) {
            toast.info(`Status history: +${historyAdded} new entries`);
          }
        } catch (histErr) {
          console.warn("[SparePartImport] status history diff failed", histErr);
        }
        // -----------------------------------------------------------------

        setFiles((cur) =>
          cur.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  status: "done",
                  progress: 100,
                  result: { inserted, updated, skipped: (f.emptyKeyCount ?? 0) + (f.duplicateKeyCount ?? 0), rejected },
                }
              : x,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("spare_parts_import_logs")
          .update({
            status: "failed",
            error_message: msg,
            duration_ms: Date.now() - startTime,
          })
          .eq("id", logId);
        setFiles((cur) =>
          cur.map((x) => (x.id === f.id ? { ...x, status: "failed", error: msg } : x)),
        );
      }
    }

    setIsRunning(false);
    toast.success(`Import complete: ${ready.length} file(s) processed`);
  }, []);

  const startImport = useCallback(async () => {
    if (isRunning) return;
    const ready = files.filter(
      (f) => f.status === "ready" && f.parsed && f.parsed.length > 0 && !f.validationError,
    );
    if (ready.length === 0) {
      toast.error("No files ready to import");
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
        setFileExcludedHeaders,
        startImport,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}