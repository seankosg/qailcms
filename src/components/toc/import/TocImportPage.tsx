import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, ShieldAlert, Upload } from "lucide-react";
import { parseTocHdecFile, type ParsedTocFile } from "@/lib/toc/hdec-parser";
import { importTocHdecBatch, type TocHdecResult } from "@/lib/toc/hdec-import.functions";
import { getTocRowsAsOf } from "@/lib/toc/rows.functions";
import { downloadTocRoundtripWorkbook } from "@/lib/toc/roundtrip-export";
import { applyImportScope, type ImportScopeOutcome } from "@/lib/import/import-scope";
import { RejectedRows, ScopeSummary } from "@/components/wrt/import/WrtImportPage";
import { DateIssuesPanel } from "@/components/import/DateIssuesPanel";

type TocParsedRow = ParsedTocFile["rows"][number];

/**
 * TOC(Handover) 임포트 — 왕복 양식 전용.
 * 흐름: 양식 내려받기 → 파일 선택(파싱) → 권한 스코프 판정 → Preview(Diff) → Apply.
 * 미매핑·강등 컬럼은 접지 않고 전부 노출하며, "이 컬럼들 없이 진행" 승인 없이는 Apply 가 활성화되지 않는다.
 */
export function TocImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedTocFile | null>(null);
  const [scope, setScope] = useState<ImportScopeOutcome<TocParsedRow> | null>(null);
  const [preview, setPreview] = useState<TocHdecResult | null>(null);
  const [result, setResult] = useState<TocHdecResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "scope" | "preview" | "apply">(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [acceptUnmapped, setAcceptUnmapped] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});

  const fetchRows = useServerFn(getTocRowsAsOf);
  const runImport = useServerFn(importTocHdecBatch);
  const canon = useQuery({
    queryKey: ["toc-rows", "import-template"],
    queryFn: () => fetchRows({ data: { as_of: null } }),
    staleTime: 60_000,
  });

  const scopeNote = scope
    ? `scope=${scope.role} in_scope=${scope.allowedRows.length} out_of_scope=${scope.deniedKeys.length}${
        scope.deniedKeys.length ? ` denied_keys=[${scope.deniedKeys.slice(0, 100).join("|")}]` : ""
      }`
    : undefined;

  const excludedColumns = useMemo(() => {
    if (!parsed) return [] as string[];
    return [
      ...parsed.unmapped_headers.map((h) => `미매핑: ${h}`),
      ...parsed.demoted_columns.map(
        (d) =>
          `강등: ${d.header}${d.sub ? ` / ${d.sub.replace(/\n/g, " ")}` : ""} — ${d.reason} (형태 일치 ${d.validPct}%, 모집단 ${d.population}건, 표본 ${d.samples
            .map((s) => `"${s}"`)
            .join(", ")})`,
      ),
    ];
  }, [parsed]);

  const payload = useMemo(() => {
    if (!parsed || !scope) return null;
    return {
      file_name: parsed.file_name,
      sheet_names: parsed.sheets.map((s) => s.sheet_name),
      rows: scope.allowedRows,
      scope_note: scopeNote,
      accepted_unmapped: excludedColumns,
      allowed_keys: scope.allowedRows.map((r) => r.item_key),
    };
  }, [parsed, scope, scopeNote, excludedColumns]);

  function onTemplate() {
    if (!canon.data) return;
    const name = downloadTocRoundtripWorkbook({ catalog: canon.data.catalog, rows: canon.data.rows });
    toast.success(`양식을 내려받았습니다 — ${name}`);
  }

  async function onFile(file: File, overrides?: Record<string, string>) {
    if (!canon.data) {
      toast.error("단계 정의를 아직 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    setBusy("parse");
    setParsed(null);
    setScope(null);
    setPreview(null);
    setResult(null);
    setAllowDeletes(false);
    setAcceptUnmapped(false);
    setLastFile(file);
    setDateOverrides(overrides ?? {});
    try {
      const p = await parseTocHdecFile(file, canon.data.catalog, { dateOverrides: overrides });
      setParsed(p);
      if (p.dateIssues.length > 0) {
        toast.warning(`${file.name}: 날짜 형식 오류 ${p.dateIssues.length}건 — 아래에서 고친 뒤 다시 읽으세요.`);
      }
      toast.success(`읽음 — ${p.rows.length}행`);
      setBusy("scope");
      const sc = await applyImportScope<TocParsedRow>("TOC", "item_key", ["team", "pic", "eng"], p.rows, (r) => r.item_key);
      setScope(sc);
      if (sc.deniedKeys.length > 0) {
        toast.warning(`권한 범위를 벗어난 ${sc.deniedKeys.length}행은 제외됩니다 (역할 ${sc.role})`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "파일을 읽지 못했습니다", { duration: 12000 });
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
      toast.error(e?.message ?? "미리보기 실패", { duration: 12000 });
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
      toast.success(`반영 — 항목 ${r.items_updated}건 / 단계 ${r.stages_upserted}건 (상태 ${r.status})`);
      void canon.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "임포트 실패", { duration: 12000 });
    } finally {
      setBusy(null);
    }
  }

  const view = result ?? preview;
  const guardBlocked = !!view?.delete_guard.tripped && !allowDeletes;
  const needsAccept = excludedColumns.length > 0 && !acceptUnmapped;
  const dateBlocked = (parsed?.dateIssues.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Handover (TOC) — 왕복 양식 임포트</CardTitle>
          <CardDescription>
            양식을 내려받아 계획일·실적일·상태 코드를 채운 뒤 그대로 올리세요. 매칭 키는 <b>ITEM KEY</b> 입니다 (원본 Item
            No 는 그룹별 번호라 중복됩니다). 컬럼이 없으면 미제공(무시), 칸이 비어 있으면 지우기로 처리합니다. 교육 항목은
            교육 세션 기록이 정본이라 이 양식으로 바꿀 수 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onTemplate} disabled={!canon.data || busy !== null}>
              <Download className="mr-2 h-4 w-4" /> 양식 내려받기
            </Button>
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
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null || !canon.data}>
              {busy === "parse" || busy === "scope" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              파일 선택
            </Button>
            <Button onClick={onPreview} disabled={!payload || busy !== null || dateBlocked}>
              {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview (Diff)
            </Button>
            <Button onClick={onApply} disabled={!preview || busy !== null || guardBlocked || needsAccept || dateBlocked}>
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
                  {s.sheet_name} → PLOT-{s.plot} · {s.rows}행
                </Badge>
              ))}
              <Badge variant="outline">단계 컬럼 {parsed.present_stage_fields.length}</Badge>
              <Badge variant="outline">항목 컬럼 {parsed.present_item_fields.length}</Badge>
              {parsed.skipped_rows > 0 && <Badge variant="outline">키 없는 행 {parsed.skipped_rows}</Badge>}
              {excludedColumns.length > 0 && <Badge variant="destructive">제외 컬럼 {excludedColumns.length}</Badge>}
            </div>
          )}

          {scope && <ScopeSummary scope={scope} />}

          {parsed && parsed.dateIssues.length > 0 && lastFile && (
            <DateIssuesPanel
              fileName={parsed.file_name}
              sheetName={null}
              issues={parsed.dateIssues}
              currentOverrides={dateOverrides}
              onApply={(ovr) => onFile(lastFile, ovr)}
              disabled={busy !== null}
            />
          )}

          {excludedColumns.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>임포트에서 제외되는 컬럼 {excludedColumns.length}개</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <div className="space-y-1">
                  {excludedColumns.map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox checked={acceptUnmapped} onCheckedChange={(v) => setAcceptUnmapped(v === true)} />
                  <span>이 컬럼들 없이 진행합니다 (선택 내용은 임포트 기록에 남습니다)</span>
                </label>
              </AlertDescription>
            </Alert>
          )}

          {parsed && parsed.ignored_headers.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>정본이 달라 무시한 컬럼 {parsed.ignored_headers.length}개</AlertTitle>
              <AlertDescription className="text-xs">{parsed.ignored_headers.join(", ")}</AlertDescription>
            </Alert>
          )}

          {parsed && parsed.unknown_code_values.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>사전에 없는 상태 코드 {parsed.unknown_code_values.length}건 — 저장되지 않습니다</AlertTitle>
              <AlertDescription className="space-y-1 text-xs">
                {Array.from(
                  parsed.unknown_code_values.reduce((m, u) => {
                    const k = `${u.stage_code} / "${u.value}"`;
                    const cur = m.get(k) ?? { count: 0, samples: [] as string[] };
                    cur.count += 1;
                    if (cur.samples.length < 3) cur.samples.push(`${u.item_key} (${u.sheet_name} / ${u.excel_row}행)`);
                    m.set(k, cur);
                    return m;
                  }, new Map<string, { count: number; samples: string[] }>()),
                )
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([k, b]) => (
                    <div key={k}>
                      {k} {b.count}건 — 예: {b.samples.join(" / ")}
                    </div>
                  ))}
              </AlertDescription>
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
                컬럼 부재 = 미제공(무시) / 빈 칸 = 지우기. 모든 변경은 변경 이력에 기록됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Stat label="전체 행" value={view.total} />
                <Stat label="매칭" value={view.matched} />
                <Stat label="신규" value={view.created} tone={view.created > 0 ? "warn" : undefined} />
                <Stat label="변경" value={view.rows_changed} />
                <Stat label="지운 값" value={view.cleared_values} tone={view.cleared_values > 0 ? "warn" : undefined} />
                <Stat label="교육 무시 칸" value={view.readonly_skipped} />
              </div>

              <div className="rounded-md border px-2 py-1.5 text-[11px]">
                <span className="mr-2 font-medium">항등식</span>
                파싱 {view.identity.parsed} = 반영 {view.identity.applied_rows} + 변경없음 {view.identity.unchanged} + 거부{" "}
                {view.identity.rejected} + 미분류{" "}
                <b className={view.identity.unclassified !== 0 ? "text-destructive" : ""}>
                  {view.identity.unclassified}
                </b>
                <span className="ml-2 text-muted-foreground">· 상태 {view.status}</span>
              </div>

              <RejectedRows rows={view.rejected} />

              {view.delete_guard.tripped && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>삭제 규모 가드 작동</AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <div>
                      값 {view.cleared_values}건이 지워집니다 — 임계 {view.delete_guard.pct}% 또는{" "}
                      {view.delete_guard.min_count}건 초과. 의도한 삭제인지 확인하세요.
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox checked={allowDeletes} onCheckedChange={(v) => setAllowDeletes(v === true)} />
                      <span>삭제를 승인하고 반영</span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {view.created > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>파일에만 있는 항목 {view.created}건 — 신규 생성</AlertTitle>
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
              <CardDescription>변경·신규 행만 (최대 300). 전체 이력은 Import Log 에 저장됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left">
                      <th className="w-24">Row</th>
                      <th className="w-72">ITEM KEY</th>
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
                        <td className="px-2 py-1 font-mono text-[11px]">{d.item_key}</td>
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
                          변경 없음.
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
