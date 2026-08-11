import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, Columns3, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  ColumnSelectDialog,
  type ColumnRequirement,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";
import {
  checkSplAconexContent,
  matchSplAconexFileName,
  parseSplAconexFile,
  readSplAconexDocumentNumbers,
  readSplAconexHeaders,
  type ParsedSplAconexFile,
} from "@/lib/spl/aconex-parser";
import {
  importSplAconexBatch,
  SPL_ACONEX_FIELDS,
  type SplAconexResult,
} from "@/lib/spl/aconex-import.functions";

/**
 * SPL Aconex Export 임포트 화면.
 * 관문은 둘 — 1차 파일명, 2차 내용(HDEC-XXX- 다수결). 둘 다 통과해야 진행한다.
 * 화면 문구는 전부 영어.
 */

const HEADER_TO_FIELDS: Record<string, string[]> = {
  "Document No": [],
  Status: ["approval_status_raw"],
  "Date Modified": ["approval_date"],
};
const UNIQUE_HEADER = "Document No";
const HEADER_ALIASES: Record<string, string> = {
  "DOCUMENT NO": "Document No",
  "DOCUMENT NO.": "Document No",
  "DOC NO": "Document No",
  "DOCUMENT NUMBER": "Document No",
  STATUS: "Status",
  "DATE MODIFIED": "Date Modified",
  "MODIFIED DATE": "Date Modified",
};
const FIELD_LABELS: Record<string, string> = {
  approval_status_raw: "Response Status",
  approval_date: "Dar Response Date",
};
function canonicalHeader(h: string): string {
  return HEADER_ALIASES[h.trim().toUpperCase().replace(/\s+/g, " ")] ?? h;
}

type GateError = { title: string; body: string[] };

export function SplAconexImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSplAconexFile | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<Record<string, unknown>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [columnOpen, setColumnOpen] = useState(false);
  const [gateError, setGateError] = useState<GateError | null>(null);
  const [preview, setPreview] = useState<SplAconexResult | null>(null);
  const [result, setResult] = useState<SplAconexResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "apply">(null);
  const runImport = useServerFn(importSplAconexBatch);

  const helpers = useMemo<ColumnSelectHelpers>(
    () => ({
      toFieldName: (h) => {
        const canon = canonicalHeader(h);
        if (canon === UNIQUE_HEADER) return "spl_number (unique key)";
        const fields = HEADER_TO_FIELDS[canon];
        if (!fields || fields.length === 0) return "";
        return fields.map((f) => FIELD_LABELS[f] ?? f).join(", ");
      },
      getRequirement: (h): ColumnRequirement =>
        canonicalHeader(h) === UNIQUE_HEADER
          ? { required: true, reason: "system", message: `"${UNIQUE_HEADER}" is the match key and cannot be unchecked.` }
          : { required: false },
      isKnownField: (field) => Boolean(field),
      getSourceLabel: () => "Aconex",
      getSourceOrigin: () => "aconex",
    }),
    [],
  );

  const applyFields = useMemo(() => {
    const ex = new Set(excluded.map(canonicalHeader));
    const excludedFields = new Set<string>();
    for (const h of ex) for (const f of HEADER_TO_FIELDS[h] ?? []) excludedFields.add(f);
    return (SPL_ACONEX_FIELDS as readonly string[]).filter((f) => !excludedFields.has(f));
  }, [excluded]);

  function reset() {
    setParsed(null);
    setHeaders([]);
    setSample({});
    setExcluded([]);
    setGateError(null);
    setPreview(null);
    setResult(null);
  }

  async function onFile(f: File) {
    reset();
    setFile(f);
    setBusy("parse");
    try {
      // Gate 1 — file name
      const nameMatch = matchSplAconexFileName(f.name);
      if (!nameMatch) {
        setGateError({
          title: "Wrong file name",
          body: [
            "This does not look like an SPL Aconex export.",
            "Expected a file name starting with:",
            "    SPL_PLOT C_ExportDocs<yyyymmdd>_<hhmm>",
            "    SPL_PLOT D_ExportDocs<yyyymmdd>_<hhmm>",
            "Example:  SPL_PLOT C_ExportDocs20260808_1240.xlsx",
            `Selected: ${f.name}`,
          ],
        });
        return;
      }

      // Gate 2 — content (HDEC-XXX- majority)
      const numbers = await readSplAconexDocumentNumbers(f);
      const check = checkSplAconexContent(numbers);
      if (!check.ok) {
        setGateError({
          title: "Wrong export content",
          body: [
            "The file name looks correct, but the documents inside are not SPL.",
            "SPL exports contain HDEC-LST- documents.",
            `Found: LST ${check.lst} · CER ${check.cer} · other ${check.other} of ${check.total}`,
            "Please export the SPL search from Aconex and try again.",
          ],
        });
        return;
      }

      const p = await parseSplAconexFile(f);
      const h = await readSplAconexHeaders(f);
      setParsed(p);
      setHeaders(h.headers);
      setSample(h.sample);
      toast.success(`Parsed — PLOT ${p.plot} · ${p.rows.length} documents (OCS excluded ${p.ocs_excluded})`);
    } catch (e: any) {
      toast.error(e?.message ?? "File parsing failed");
    } finally {
      setBusy(null);
    }
  }

  const payload = useMemo(() => {
    if (!parsed) return null;
    return {
      file_name: parsed.file_name,
      sheet_name: parsed.sheet_name,
      plot: parsed.plot,
      export_date: parsed.export_date,
      ocs_excluded: parsed.ocs_excluded,
      rows: parsed.rows.map((r) => ({
        document_no: r.document_no,
        status_raw: r.status_raw,
        code: r.code,
        date_modified: r.date_modified,
        excel_row: r.excel_row,
      })),
      apply_fields: applyFields as any,
    };
  }, [parsed, applyFields]);

  async function onPreview() {
    if (!payload) return;
    setBusy("preview");
    try {
      const r = await runImport({ data: { ...payload, apply: false } as any });
      setPreview(r);
      setResult(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function onApply() {
    if (!payload) return;
    setBusy("apply");
    try {
      const r = await runImport({ data: { ...payload, apply: true } as any });
      setResult(r);
      setPreview(r);
      toast.success(`Applied — ${r.items_updated} item(s) / ${r.stages_upserted} response date(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed", { duration: 10000 });
    } finally {
      setBusy(null);
    }
  }

  const view = result ?? preview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spare Parts (SPL) — Aconex Import</CardTitle>
          <CardDescription>
            Upload the Aconex Docs export (SPL_PLOT C/D_ExportDocs&lt;yyyymmdd&gt;_&lt;hhmm&gt;.xlsx). Existing items are{" "}
            <b>updated only</b> — no rows are created. Only two cells are written: <b>Response Status</b> and{" "}
            <b>Dar Response Date</b>. For Review keeps the status but never writes a response date, and blank cells never
            clear existing values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === "parse" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Choose file
            </Button>
            <Button variant="outline" onClick={() => setColumnOpen(true)} disabled={!parsed || busy !== null}>
              <Columns3 className="mr-2 h-4 w-4" />
              Columns
            </Button>
            <Button onClick={onPreview} disabled={!payload || busy !== null}>
              {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview (Diff)
            </Button>
            <Button onClick={onApply} disabled={!preview || busy !== null}>
              {busy === "apply" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </div>

          {gateError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{gateError.title}</AlertTitle>
              <AlertDescription>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5">{gateError.body.join("\n")}</pre>
              </AlertDescription>
            </Alert>
          )}

          {parsed && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="gap-1">
                <FileSpreadsheet className="h-3 w-3" /> {parsed.file_name}
              </Badge>
              <Badge variant="default">PLOT {parsed.plot}</Badge>
              <Badge variant="outline">Export date {parsed.export_date}</Badge>
              <Badge variant="outline">
                {parsed.sheet_name} · header row {parsed.header_row}
              </Badge>
              <Badge variant="outline">Documents {parsed.rows.length}</Badge>
              <Badge variant={parsed.ocs_excluded > 0 ? "destructive" : "outline"}>
                OCS excluded {parsed.ocs_excluded}
              </Badge>
              <Badge variant="outline">No Status skipped {parsed.no_status}</Badge>
              {parsed.duplicates > 0 && <Badge variant="outline">Duplicates {parsed.duplicates}</Badge>}
              <Badge variant="outline">Fields {applyFields.map((f) => FIELD_LABELS[f] ?? f).join(" · ") || "none"}</Badge>
            </div>
          )}

          {parsed && parsed.unmapped_statuses.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Unmapped status values — reported only, nothing is written</AlertTitle>
              <AlertDescription className="text-xs">
                {parsed.unmapped_statuses.map((u) => `${u.status} (${u.count})`).join(", ")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {file && parsed && (
        <ColumnSelectDialog
          open={columnOpen}
          onOpenChange={setColumnOpen}
          fileName={file.name}
          headers={headers}
          samples={sample}
          defaultExcluded={excluded}
          onApply={(ex) => setExcluded(ex)}
          helpers={helpers}
          lockRequired
        />
      )}

      {view && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Diff summary</CardTitle>
              <CardDescription>
                Update only. Unmatched documents are reported and skipped. Every change is recorded in the change log.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Stat label="Documents" value={view.aconex_documents} />
                <Stat label="Matched" value={view.matched} />
                <Stat label="Unmatched" value={view.aconex_only} tone={view.aconex_only > 0 ? "warn" : undefined} />
                <Stat label="Cells changed" value={view.cells_changed} />
                <Stat label="For Review (no date)" value={view.review_no_date} />
                <Stat label="Out of scope" value={view.out_of_scope} tone={view.out_of_scope > 0 ? "warn" : undefined} />
              </div>

              {view.blank_overwrites > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Blank overwrite detected ({view.blank_overwrites})</AlertTitle>
                  <AlertDescription className="text-xs">
                    Aconex import must never clear an existing value. Do not apply and report this.
                  </AlertDescription>
                </Alert>
              )}

              {view.aconex_only > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{view.aconex_only} document(s) not in the SPL list — skipped</AlertTitle>
                  <AlertDescription className="text-[11px] font-mono">
                    {view.aconex_only_list.slice(0, 50).join(", ")}
                    {view.aconex_only_list.length > 50 ? " …" : ""}
                  </AlertDescription>
                </Alert>
              )}

              {view.field_diff_counts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {view.field_diff_counts.map((f) => (
                    <Badge key={f.field} variant="outline" className="text-[11px]">
                      {FIELD_LABELS[f.field] ?? f.field} · {f.changed}
                    </Badge>
                  ))}
                </div>
              )}

              {view.status_counts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {view.status_counts.map((s) => (
                    <Badge key={s.status} variant="secondary" className="text-[11px]">
                      {s.status} · {s.count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Row-level log</CardTitle>
              <CardDescription>Changed rows only (max 300). Full history is stored in the Import Log.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left">
                      <th className="w-16">Row</th>
                      <th className="w-72">Document No</th>
                      <th className="w-40">Status</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.diff_rows.map((d) => (
                      <tr key={`${d.document_no}-${d.excel_row}`} className="border-t align-top">
                        <td className="px-2 py-1 text-muted-foreground">r{d.excel_row ?? "-"}</td>
                        <td className="px-2 py-1 font-mono text-[11px]">{d.document_no}</td>
                        <td className="px-2 py-1">
                          <Badge variant="secondary" className="text-[10px]">
                            {d.code ?? "—"}
                          </Badge>
                          <span className="ml-1 text-muted-foreground">{d.status_raw}</span>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-wrap gap-1">
                            {d.changes.map((c, i) => (
                              <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                {FIELD_LABELS[c.field] ?? c.field}: {c.previous ?? "∅"} → {c.next ?? "∅"}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {view.diff_rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                          No changes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === "warn" ? "text-amber-600" : ""}`}>{value.toLocaleString()}</div>
    </div>
  );
}
