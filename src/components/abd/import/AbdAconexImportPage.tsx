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
  type ColumnRequirement,
} from "@/components/import/ColumnSelectDialog";
import { ABD_ACONEX_SYNC_FIELDS } from "@/components/admin/AbdImportPresetTable";

type Status = "queued" | "parsing" | "ready" | "previewing" | "preview" | "importing" | "done" | "error";

/**
 * Aconex Export 파일의 실제 Excel 헤더 → 반영 대상 sync 필드 매핑.
 * - `Document No` 는 매칭 유니크 키 (항상 필수, 잠금).
 * - 나머지 헤더를 체크 해제하면 해당 sync 필드가 UPDATE 에서 제외됨.
 * - 여기서 다루지 않는 헤더(File / Title / Discipline …)는 참고용으로 목록에만 노출.
 */
const ACONEX_HEADER_TO_FIELDS: Record<string, string[]> = {
  "Document No": [], // unique key
  "Revision": ["latest_rev"],
  "Status": [
    "latest_status",
    "approval_date",
    "aconex_status_raw",
    "round_actual",
    "is_terminated",
  ],
  "Review Status": ["aconex_review_status_raw", "round_actual", "is_terminated"],
  "Date Modified": ["aconex_date_modified", "round_actual", "approval_date"],
};
const ACONEX_UNIQUE_HEADER = "Document No";
/** 파일에 실제 위 헤더가 없을 때 대체 인식 (대문자/공백 정규화 후 비교). */
const HEADER_ALIASES: Record<string, string> = {
  "DOCUMENT NO": "Document No",
  "DOC NO": "Document No",
  "DOCUMENT NUMBER": "Document No",
  "REVISION": "Revision",
  "REV": "Revision",
  "STATUS": "Status",
  "REVIEW STATUS": "Review Status",
  "DATE MODIFIED": "Date Modified",
  "MODIFIED DATE": "Date Modified",
};
function canonicalHeader(h: string): string {
  const key = h.trim().toUpperCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[key] ?? h;
}

const SEMANTIC_LABELS: Record<string, string> = {
  DAR_APPROVED_A: "DAR Approved (A)",
  DAR_APPROVED_B: "DAR Approved w/ Comments (B)",
  DAR_REJECTED: "DAR Rejected (C/D)",
  SUBMITTED: "Submitted (HDEC 우선)",
  EXCLUDED_TERMINATED: "Terminated (제외)",
  EXCLUDED_CANCELLED: "Cancelled (제외)",
  UNKNOWN: "미분류",
};

interface Entry {
  id: string;
  file: File;
  status: Status;
  parsed?: ParsedAconexFile;
  preview?: AconexImportPreview;
  result?: AconexImportPreview & { updated: number };
  error?: string;
  /** 이 파일에서 체크 해제된 Excel 헤더 목록 (기본 = 전체 포함). */
  excludedHeaders?: string[];
  /** 실제 파일에서 감지된 헤더 목록 (컬럼 선택 다이얼로그 표시용). */
  fileHeaders?: string[];
  /** 각 헤더 첫 데이터 행 샘플. */
  sampleRow?: Record<string, unknown>;
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
    return {
      toFieldName: (h) => {
        const canon = canonicalHeader(h);
        const fields = ACONEX_HEADER_TO_FIELDS[canon];
        if (!fields) return "";
        if (canon === ACONEX_UNIQUE_HEADER) return "abd_number (unique key)";
        return fields.map((f) => syncLabelMap.get(f) ?? f).join(", ");
      },
      getRequirement: (h): ColumnRequirement => {
        if (canonicalHeader(h) === ACONEX_UNIQUE_HEADER) {
          return {
            required: true,
            reason: "system",
            message: `"${ACONEX_UNIQUE_HEADER}" 은(는) 매칭 유니크 키입니다. 해제할 수 없습니다.`,
          };
        }
        return { required: false };
      },
      isKnownField: (field) => Boolean(field),
      getSourceLabel: () => "Aconex",
      getSourceOrigin: () => "aconex",
    };
  }, [syncLabelMap]);

  /** DB 프리셋(canonical sync 필드 저장)을 파일 헤더 기준으로 변환. */
  const buildPresetHeaders = (
    fileHeaders: string[],
    presetFields: string[],
  ): string[] => {
    const keep = new Set(presetFields);
    return fileHeaders.filter((h) => {
      const canon = canonicalHeader(h);
      if (canon === ACONEX_UNIQUE_HEADER) return true; // always keep unique key
      const fields = ACONEX_HEADER_TO_FIELDS[canon];
      if (!fields || fields.length === 0) return false;
      return fields.some((f) => keep.has(f));
    });
  };

  const columnFile = useMemo(
    () => entries.find((x) => x.id === columnFileId) ?? null,
    [entries, columnFileId],
  );

  const computeApplyFieldsFromHeaders = (
    excludedHeaders: string[] | undefined,
  ): string[] => {
    const ex = new Set((excludedHeaders ?? []).map(canonicalHeader));
    const excludedFields = new Set<string>();
    for (const h of ex) {
      const fields = ACONEX_HEADER_TO_FIELDS[h];
      if (fields) for (const f of fields) excludedFields.add(f);
    }
    return syncFieldKeys.filter((f) => !excludedFields.has(f));
  };

  const presetsForFile = (fileHeaders: string[]) => [
    { id: "__all", label: "전체 선택", matchedHeaders: undefined },
    ...aconexPresets.map((p) => ({
      id: p.id,
      label: p.label,
      matchedHeaders: buildPresetHeaders(fileHeaders, p.fields),
    })),
  ];

  const setFileExcludedHeaders = (id: string, excluded: string[]) => {
    setEntries((prev) =>
      prev.map((x) => (x.id === id ? { ...x, excludedHeaders: excluded } : x)),
    );
    if (excluded.length > 0) {
      toast.info(
        `컬럼 선택: 제외 ${excluded.length}개 — ${excluded.slice(0, 3).join(", ")}${excluded.length > 3 ? " …" : ""}`,
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
        // 파일의 원본 헤더 & 첫 데이터 행 샘플 추출 (컬럼 선택 다이얼로그용).
        const { fileHeaders, sampleRow } = await readFileHeaders(e.file);
        setEntries((p) =>
          p.map((x) =>
            x.id === e.id
              ? { ...x, parsed, fileHeaders, sampleRow, status: "previewing" }
              : x,
          ),
        );
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
      semantic: r.semantic,
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
        const applyFields = computeApplyFieldsFromHeaders(e.excludedHeaders);
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
              semantic: r.semantic,
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
                      {e.preview && e.preview.by_semantic && e.preview.by_semantic.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.preview.by_semantic.map((s) => (
                            <Badge
                              key={s.semantic}
                              variant="outline"
                              className="text-[10px]"
                              title={SEMANTIC_LABELS[s.semantic] ?? s.semantic}
                            >
                              {SEMANTIC_LABELS[s.semantic] ?? s.semantic}: {s.count}
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
                      {e.preview && (e.preview.field_diff_counts?.length ?? 0) > 0 && (
                        <div className="mt-2 rounded border border-dashed bg-muted/30 p-2">
                          <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] font-medium">
                            <span>실제 변경 예상</span>
                            {e.preview.field_diff_counts.map((f) => (
                              <Badge
                                key={f.field}
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                {f.field}: {f.changed}
                              </Badge>
                            ))}
                          </div>
                          {(e.preview.diff_rows?.length ?? 0) > 0 && (
                            <details className="text-[11px]">
                              <summary className="cursor-pointer text-muted-foreground">
                                Before / After 샘플 보기 (최대 200 행)
                              </summary>
                              <div className="mt-1 max-h-64 overflow-auto">
                                <table className="w-full border-collapse text-[10px]">
                                  <thead className="sticky top-0 bg-background">
                                    <tr className="border-b">
                                      <th className="p-1 text-left">Document No</th>
                                      <th className="p-1 text-left">Row</th>
                                      <th className="p-1 text-left">Field</th>
                                      <th className="p-1 text-left">Before</th>
                                      <th className="p-1 text-left">After</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {e.preview.diff_rows.flatMap((d) =>
                                      d.changes.map((ch, i) => (
                                        <tr
                                          key={`${d.document_no}-${ch.field}-${i}`}
                                          className="border-b last:border-0"
                                        >
                                          {i === 0 && (
                                            <>
                                              <td
                                                className="p-1 font-mono align-top"
                                                rowSpan={d.changes.length}
                                              >
                                                {d.document_no}
                                              </td>
                                              <td
                                                className="p-1 align-top text-muted-foreground"
                                                rowSpan={d.changes.length}
                                              >
                                                {d.excel_row ?? "-"}
                                              </td>
                                            </>
                                          )}
                                          <td className="p-1 font-mono">{ch.field}</td>
                                          <td className="p-1 font-mono text-rose-700 dark:text-rose-300">
                                            {ch.previous ?? "∅"}
                                          </td>
                                          <td className="p-1 font-mono text-emerald-700 dark:text-emerald-300">
                                            {ch.next ?? "∅"}
                                          </td>
                                        </tr>
                                      )),
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          )}
                        </div>
                      )}
                      {e.error && <p className="mt-1 text-xs text-destructive">{e.error}</p>}
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => setColumnFileId(e.id)}
                          disabled={busy || e.status === "importing" || e.status === "done"}
                        >
                          <Columns3 className="h-3.5 w-3.5" /> 컬럼 선택
                          {e.excludedHeaders && e.excludedHeaders.length > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              (제외 {e.excludedHeaders.length})
                            </span>
                          )}
                        </Button>
                      </div>
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
      {columnFile && (
        <ColumnSelectDialog
          open={!!columnFile}
          onOpenChange={(o) => {
            if (!o) setColumnFileId(null);
          }}
          fileName={columnFile.file.name}
          headers={columnFile.fileHeaders ?? []}
          samples={columnFile.sampleRow ?? {}}
          defaultExcluded={columnFile.excludedHeaders ?? []}
          onApply={(excluded) => setFileExcludedHeaders(columnFile.id, excluded)}
          helpers={helpers}
          presets={presetsForFile(columnFile.fileHeaders ?? [])}
          lockRequired
        />
      )}
    </div>
  );
}

/** Aconex Export 파일에서 헤더 행과 첫 데이터 행 샘플만 가볍게 추출. */
async function readFileHeaders(
  file: File,
): Promise<{ fileHeaders: string[]; sampleRow: Record<string, unknown> }> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const sheetName =
    wb.SheetNames.find((n) => n.toUpperCase() === "DOCS") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const ref = ws["!ref"];
  if (!ref) return { fileHeaders: [], sampleRow: {} };
  const range = XLSX.utils.decode_range(ref);
  const scanEnd = Math.min(range.s.r + 29, range.e.r);
  // 헤더 행 = "Document No" / "Status" 셀 포함한 최상단 행.
  let headerRow = -1;
  const norm = (v: any) =>
    String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  for (let r = range.s.r; r <= scanEnd; r++) {
    let hasDoc = false;
    let hasStatus = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = norm(ws[XLSX.utils.encode_cell({ r, c })]?.v);
      if (["DOCUMENT NO", "DOC NO", "DOCUMENT NUMBER"].includes(v)) hasDoc = true;
      if (v === "STATUS") hasStatus = true;
    }
    if (hasDoc && hasStatus) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return { fileHeaders: [], sampleRow: {} };
  const headers: string[] = [];
  const colByHeader: Record<string, number> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = ws[XLSX.utils.encode_cell({ r: headerRow, c })]?.v;
    if (v == null || String(v).trim() === "") continue;
    const label = String(v).trim();
    headers.push(label);
    colByHeader[label] = c;
  }
  const sample: Record<string, unknown> = {};
  const dataRow = headerRow + 1;
  if (dataRow <= range.e.r) {
    for (const h of headers) {
      const c = colByHeader[h];
      const v = ws[XLSX.utils.encode_cell({ r: dataRow, c })]?.v;
      sample[h] = v ?? "";
    }
  }
  return { fileHeaders: headers, sampleRow: sample };
}