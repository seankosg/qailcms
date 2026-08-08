import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Loader2, ShieldAlert, Upload } from "lucide-react";
import { parseSplHdecFile, type ParsedSplFile } from "@/lib/spl/hdec-parser";
import { importSplHdecBatch, type SplHdecResult } from "@/lib/spl/hdec-import.functions";
import { applyImportScope, type ImportScopeOutcome } from "@/lib/import/import-scope";
import { AconexPlanGapLine, RejectedRows, ScopeSummary } from "@/components/wrt/import/WrtImportPage";

type SplParsedRow = ParsedSplFile["rows"][number];

export function SplImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedSplFile | null>(null);
  const [scope, setScope] = useState<ImportScopeOutcome<SplParsedRow> | null>(null);
  const [preview, setPreview] = useState<SplHdecResult | null>(null);
  const [result, setResult] = useState<SplHdecResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "scope" | "preview" | "apply">(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const runImport = useServerFn(importSplHdecBatch);

  const scopeNote = scope
    ? `scope=${scope.role} in_scope=${scope.allowedRows.length} out_of_scope=${scope.deniedKeys.length}${scope.deniedKeys.length ? ` denied_keys=[${scope.deniedKeys.slice(0, 100).join("|")}${scope.deniedKeys.length > 100 ? "|…" : ""}]` : ""}`
    : undefined;

  const payload = useMemo(() => {
    if (!parsed || !scope) return null;
    return {
      file_name: parsed.file_name,
      sheet_names: parsed.sheets.map((s) => s.sheet_name),
      ocs_excluded: parsed.ocs_excluded,
      rows: scope.allowedRows,
      scope_note: scopeNote,
      allowed_keys: scope.allowedRows.map((r) => r.spl_number),
    };
  }, [parsed, scope, scopeNote]);

  async function onFile(file: File) {
    setBusy("parse");
    setParsed(null);
    setScope(null);
    setPreview(null);
    setResult(null);
    setAllowDeletes(false);
    try {
      const p = await parseSplHdecFile(file);
      setParsed(p);
      toast.success(`Parsed — ${p.rows.length} rows (OCS excluded ${p.ocs_excluded})`);
      setBusy("scope");
      const sc = await applyImportScope<SplParsedRow>(
        "SPL",
        "spl_number",
        ["team", "pic", "eng", "pic_po", "eng_po"],
        p.rows,
        (r) => r.spl_number,
      );
      setScope(sc);
      if (sc.deniedKeys.length > 0) {
        toast.warning(`${sc.deniedKeys.length} row(s) out of permission scope are excluded (role ${sc.role})`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "File parsing failed");
    } finally {
      setBusy(null);
    }
  }

  async function onPreview() {
    if (!payload) return;
    setBusy("preview");
    try {
      const r = await runImport({ data: { ...payload, apply: false, allow_deletes: false } });
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
      const r = await runImport({ data: { ...payload, apply: true, allow_deletes: allowDeletes } });
      setResult(r);
      setPreview(r);
      toast.success(`Applied — ${r.items_updated} item(s) / ${r.stages_upserted} stage(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed", { duration: 10000 });
    } finally {
      setBusy(null);
    }
  }

  const view = result ?? preview;
  const guardBlocked = !!view?.delete_guard.tripped && !allowDeletes;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spare Parts (SPL) — HDEC Import</CardTitle>
          <CardDescription>
            Upload the Aconex-seeded workbook (SPL_Status_AconexSeeded.xlsx) filled in with plan dates, TEAM, PIC/ENG and
            SUPPLIER. The match key is <b>SPL NUMBER</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === "parse" || busy === "scope" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Choose file
            </Button>
            <Button onClick={onPreview} disabled={!payload || busy !== null}>
              {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview (Diff)
            </Button>
            <Button variant="default" onClick={onApply} disabled={!preview || busy !== null || guardBlocked}>
              {busy === "apply" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </div>

          {parsed && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="gap-1">
                <FileSpreadsheet className="h-3 w-3" /> {parsed.file_name}
              </Badge>
              {parsed.sheets.map((s) => (
                <Badge key={s.sheet_name} variant="outline">
                  {s.sheet_name} → PLOT-{s.plot} · {s.rows} rows
                </Badge>
              ))}
              <Badge variant={parsed.ocs_excluded > 0 ? "destructive" : "outline"}>
                OCS excluded {parsed.ocs_excluded}
              </Badge>
              <Badge variant="outline">Stage columns {parsed.present_stage_fields.length}</Badge>
              {parsed.unknown_headers.length > 0 && (
                <Badge variant="destructive">Unknown headers {parsed.unknown_headers.length}</Badge>
              )}
            </div>
          )}

          {scope && <ScopeSummary scope={scope} />}

          {parsed && parsed.unknown_headers.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Headers not in catalog</AlertTitle>
              <AlertDescription className="text-xs">{parsed.unknown_headers.join(", ")}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {view && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Diff summary</CardTitle>
              <CardDescription>
                Missing column = not provided (ignored) / empty cell = intent to clear. Every change is recorded in the
                change log.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Stat label="Total rows" value={view.total} />
                <Stat label="Matched" value={view.matched} />
                <Stat label="Created" value={view.created} tone={view.created > 0 ? "warn" : undefined} />
                <Stat label="Updated" value={view.rows_changed} />
                <Stat label="Cleared values" value={view.cleared_values} tone={view.cleared_values > 0 ? "warn" : undefined} />
                <Stat label="OCS excluded" value={view.ocs_excluded} />
              </div>

              <AconexPlanGapLine items={view.aconex_plan_missing} />

              <RejectedRows rows={view.rejected} />

              {view.delete_guard.tripped && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Delete guard tripped</AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <div>
                      {view.cleared_values} value(s) would be cleared — over the threshold ({view.delete_guard.pct}% or{" "}
                      {view.delete_guard.min_count} cells). Confirm the deletions are intended before applying.
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox checked={allowDeletes} onCheckedChange={(v) => setAllowDeletes(v === true)} />
                      <span>Approve the deletions and apply</span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {view.created > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{view.created} new item(s) — numbers found only in the file</AlertTitle>
                  <AlertDescription className="text-xs">{view.created_list.join(", ")}</AlertDescription>
                </Alert>
              )}

              {view.field_diff_counts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {view.field_diff_counts.slice(0, 40).map((f) => (
                    <Badge key={f.field} variant="outline" className="text-[11px]">
                      {f.field} · {f.changed}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Row-level log</CardTitle>
              <CardDescription>
                Changed / unmatched rows only (max 300). The full history is stored in the Import Log.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left">
                      <th className="w-20">Row</th>
                      <th className="w-64">SPL NUMBER</th>
                      <th className="w-24">Outcome</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.diff_rows.map((d) => (
                      <tr key={`${d.sheet_name}-${d.excel_row}`} className="border-t align-top">
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.sheet_name} r{d.excel_row}
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">{d.spl_number}</td>
                        <td className="px-2 py-1">
                          <Badge variant={d.outcome === "created" ? "default" : "secondary"} className="text-[10px]">
                            {d.outcome}
                          </Badge>
                        </td>
                        <td className="px-2 py-1">
                          {d.changes.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {d.changes.map((c, i) => (
                                <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                  {c.target === "item" ? c.field : `${c.target}.${c.field}`}: {c.previous ?? "∅"} →{" "}
                                  {c.next ?? "∅"}
                                </span>
                              ))}
                            </div>
                          )}
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