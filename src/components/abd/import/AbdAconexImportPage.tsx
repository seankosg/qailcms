import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { parseAconexFile, type ParsedAconexFile } from "@/lib/abd/aconex-parser";
import {
  importAbdAconexBatch,
  type AconexImportPreview,
} from "@/lib/abd/aconex-import.functions";
import { todayInDoha } from "@/lib/time/doha";
import {
  ColumnSelectDialog,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";
import { ABD_ACONEX_SYNC_FIELDS } from "@/components/admin/AbdImportPresetTable";

type Status = "queued" | "parsing" | "ready" | "previewing" | "preview" | "importing" | "done" | "error";

interface Entry {
  id: string;
  file: File;
  status: Status;
  parsed?: ParsedAconexFile;
  preview?: AconexImportPreview;
  result?: AconexImportPreview & { updated: number };
  error?: string;
  /** 이 파일에서 UPDATE 제외할 sync 필드 목록 (기본 = 전체 포함). */
  excludedFields?: string[];
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export interface AbdAconexImportPageProps {
  /** 상단 안내 문구/알림 숨김 (탭에 내장할 때 사용) */
  hideHeader?: boolean;
}

export function AbdAconexImportPage({ hideHeader }: AbdAconexImportPageProps = {}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [columnFileId, setColumnFileId] = useState<string | null>(null);

  const syncFieldKeys = useMemo(
    () => ABD_ACONEX_SYNC_FIELDS.map((o) => o.field),
    [],
  );
  const syncLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of ABD_ACONEX_SYNC_FIELDS) m.set(o.field, o.label);
    return m;
  }, []);

  const { data: aconexPresets = [] } = useQuery({
    queryKey: ["abd-import-presets", "aconex"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("abd_import_presets")
        .select("*")
        .eq("mode", "aconex")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        label: string;
        fields: string[];
      }>;
    },
    staleTime: 10_000,
  });

  const helpers = useMemo<ColumnSelectHelpers>(() => {
    const knownSet = new Set(syncFieldKeys);
    return {
      toFieldName: (h) => h,
      getRequirement: () => ({ required: false }),
      isKnownField: (field) => knownSet.has(field),
      getSourceLabel: () => "Aconex",
      getSourceOrigin: () => "aconex",
    };
  }, [syncFieldKeys]);

  const presets = useMemo(
    () => [
      { id: "__all", label: "전체 선택", matchedHeaders: undefined },
      ...aconexPresets.map((p) => ({
        id: p.id,
        label: p.label,
        matchedHeaders: p.fields.filter((f) => syncFieldKeys.includes(f)),
      })),
    ],
    [aconexPresets, syncFieldKeys],
  );

  const columnFile = useMemo(
    () => entries.find((x) => x.id === columnFileId) ?? null,
    [entries, columnFileId],
  );

  const computeApplyFields = (excluded: string[] | undefined): string[] => {
    const ex = new Set(excluded ?? []);
    return syncFieldKeys.filter((f) => !ex.has(f));
  };

  const setFileExcludedFields = (id: string, excluded: string[]) => {
    setEntries((prev) =>
      prev.map((x) => (x.id === id ? { ...x, excludedFields: excluded } : x)),
    );
    if (excluded.length > 0) {
      const shown = excluded
        .map((f) => syncLabelMap.get(f) ?? f)
        .slice(0, 3)
        .join(", ");
      toast.info(
        `컬럼 선택: 제외 ${excluded.length}개${excluded.length > 3 ? "" : ` — ${shown}`}`,
      );
    }
  };

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const created: Entry[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "queued",
    }));
    setEntries((prev) => [...prev, ...created]);
    for (const e of created) {
      try {
        setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, status: "parsing" } : x)));
        const parsed = await parseAconexFile(e.file);
        setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, parsed, status: "previewing" } : x)));
        const preview = await importAbdAconexBatch({
          data: {
            file_name: e.file.name,
            data_date: todayInDoha(),
            rows: parsed.rows.map((r) => ({
              document_no: r.document_no,
              revision: r.revision,
              status_raw: r.status_raw,
              review_status_raw: r.review_status_raw,
              status_code: r.status_code,
              status_norm: r.status_norm,
              date_modified: r.date_modified,
              is_excluded: r.is_excluded,
              excel_row: r.excel_row,
            })),
            apply: false,
            apply_fields: null,
          } as any,
        });
        setEntries((p) =>
          p.map((x) => (x.id === e.id ? { ...x, preview, status: "preview" } : x)),
        );
      } catch (err: any) {
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id ? { ...x, status: "error", error: err?.message ?? String(err) } : x,
          ),
        );
      }
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFiles(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFiles],
  );

  const readyEntries = useMemo(
    () => entries.filter((e) => e.status === "preview" && e.parsed && e.preview),
    [entries],
  );
  const readyCount = readyEntries.length;

  const startImport = async () => {
    setBusy(true);
    for (const e of readyEntries) {
      if (!e.parsed) continue;
      setEntries((p) => p.map((x) => (x.id === e.id ? { ...x, status: "importing" } : x)));
      try {
        const applyFields = computeApplyFields(e.excludedFields);
        if (applyFields.length === 0) {
          throw new Error("적용할 sync 컬럼이 없습니다. 컬럼 선택에서 최소 1개 이상 포함하세요.");
        }
        const result = await importAbdAconexBatch({
          data: {
            file_name: e.file.name,
            data_date: todayInDoha(),
            rows: e.parsed.rows.map((r) => ({
              document_no: r.document_no,
              revision: r.revision,
              status_raw: r.status_raw,
              review_status_raw: r.review_status_raw,
              status_code: r.status_code,
              status_norm: r.status_norm,
              date_modified: r.date_modified,
              is_excluded: r.is_excluded,
              excel_row: r.excel_row,
            })),
            apply: true,
            apply_fields: applyFields,
          } as any,
        });
        setEntries((p) =>
          p.map((x) => (x.id === e.id ? { ...x, status: "done", result } : x)),
        );
        toast.success(
          `${e.file.name}: ${result.updated} 건 상태 동기화 (미매칭 ${result.unmatched})`,
        );
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        setEntries((p) =>
          p.map((x) => (x.id === e.id ? { ...x, status: "error", error: msg } : x)),
        );
        toast.error(`${e.file.name} 실패: ${msg}`);
      }
    }
    setBusy(false);
  };

  const removeEntry = (id: string) => setEntries((p) => p.filter((x) => x.id !== id));
  const clearAll = () => setEntries([]);

  return (
    <div className="space-y-4">
      {!hideHeader && (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Aconex Export 임포트 규칙</AlertTitle>
        <AlertDescription className="text-xs space-y-1">
          <div>· Aconex 시스템에서 다운로드한 Docs 시트를 업로드하면 <code>Document No</code> 기준으로 매칭됩니다.</div>
          <div>· 매칭된 도면의 <b>Status(A/B/C/D/UR/Cancelled/Terminated)</b>, <b>Revision</b>, <b>Date Modified</b> 를 갱신합니다.</div>
          <div>· <b>DB에 없는 Document No</b> 는 자동으로 INSERT 되지 않고 미매칭 목록으로 리포트됩니다.</div>
          <div>· Status = <code>A - Approved</code> 이면 <code>Approval Date</code> 를 <code>Date Modified</code> 로 자동 반영합니다.</div>
          <div>· <code>Cancelled</code> / <code>Terminated</code> 항목은 통계/대시보드 계산에서 제외됩니다.</div>
        </AlertDescription>
      </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Aconex Export 업로드</CardTitle>
          <CardDescription>파일 확장자 .xlsx (Docs 시트).</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition hover:border-primary hover:bg-accent/30"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Aconex Export 파일을 드롭하거나 클릭하여 선택</p>
            <p className="text-xs text-muted-foreground">.xlsx — 다중 파일 지원</p>
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
              <CardDescription>{readyCount} ready to sync</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={clearAll} disabled={busy}>
                Clear all
              </Button>
              <Button size="sm" onClick={startImport} disabled={busy || readyCount === 0}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Syncing…
                  </>
                ) : (
                  `Sync (${readyCount})`
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {entries.map((e) => (
              <div key={e.id} className="rounded border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{e.file.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{formatSize(e.file.size)}</span>
                        {e.parsed && <span>· {e.parsed.rows.length} rows</span>}
                        {e.preview && (
                          <>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              matched {e.preview.matched}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              unmatched {e.preview.unmatched}
                            </Badge>
                            {e.preview.excluded > 0 && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                excluded {e.preview.excluded}
                              </Badge>
                            )}
                          </>
                        )}
                        {e.result && (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 font-mono text-[10px]">
                            updated {e.result.updated}
                          </Badge>
                        )}
                        {e.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                      </div>
                      {e.preview && e.preview.by_status.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.preview.by_status.map((s) => (
                            <Badge key={s.code} variant="secondary" className="text-[10px]">
                              {s.code}: {s.count}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {e.preview && e.preview.unmatched_samples.length > 0 && (
                        <details className="mt-2 text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer">미매칭 Document No 샘플 ({e.preview.unmatched_samples.length})</summary>
                          <ul className="mt-1 max-h-40 overflow-auto space-y-0.5 font-mono">
                            {e.preview.unmatched_samples.map((d) => (
                              <li key={d}>{d}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {e.error && <p className="mt-1 text-xs text-destructive">{e.error}</p>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeEntry(e.id)} disabled={busy}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}