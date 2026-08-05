import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Loader2, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { parseWrtHdecFile, type ParsedWrtFile } from "@/lib/wrt/hdec-parser";
import { importWrtHdecBatch, type WrtHdecResult } from "@/lib/wrt/hdec-import.functions";
import { applyImportScope, type ImportScopeOutcome } from "@/lib/import/import-scope";

type WrtParsedRow = ParsedWrtFile["rows"][number];

export function WrtImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWrtFile | null>(null);
  const [scope, setScope] = useState<ImportScopeOutcome<WrtParsedRow> | null>(null);
  const [preview, setPreview] = useState<WrtHdecResult | null>(null);
  const [result, setResult] = useState<WrtHdecResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "scope" | "preview" | "apply">(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const runImport = useServerFn(importWrtHdecBatch);

  const scopeNote = scope ? `scope=${scope.role} in_scope=${scope.allowedRows.length} out_of_scope=${scope.deniedKeys.length}${scope.deniedKeys.length ? ` denied_keys=[${scope.deniedKeys.slice(0, 100).join("|")}${scope.deniedKeys.length > 100 ? "|…" : ""}]` : ""}` : undefined;

  const payload = useMemo(() => {
    if (!parsed || !scope) return null;
    return {
      file_name: parsed.file_name,
      sheet_names: parsed.sheets.map((s) => s.sheet_name),
      rows: scope.allowedRows,
      scope_note: scopeNote,
      allowed_keys: scope.allowedRows.map((r) => r.wrt_number),
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
      const p = await parseWrtHdecFile(file);
      setParsed(p);
      toast.success(`파싱 완료 — ${p.rows.length}행 (건너뜀 ${p.skipped_rows}행)`);
      setBusy("scope");
      const sc = await applyImportScope<WrtParsedRow>(
        "WRT",
        "wrt_number",
        ["team", "pic", "eng"],
        p.rows,
        (r) => r.wrt_number,
      );
      setScope(sc);
      if (sc.deniedKeys.length > 0) {
        toast.warning(`권한 범위 밖 ${sc.deniedKeys.length}행이 제외됩니다 (역할 ${sc.role})`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "파일 파싱 실패");
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
      toast.error(e?.message ?? "미리보기 실패");
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
      toast.success(`반영 완료 — 아이템 ${r.items_updated}건 / 단계 ${r.stages_upserted}건`);
    } catch (e: any) {
      toast.error(e?.message ?? "임포트 실패", { duration: 10000 });
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
          <CardTitle className="text-base">Warranty &amp; License (WRT) — HDEC Import</CardTitle>
          <CardDescription>
            Aconex 시딩본에 계획일·TEAM·PIC/ENG 를 채워 되돌린 파일을 업로드합니다. 매칭 키는 <b>WRT NUMBER</b> 이며,
            미매칭 항목은 생성하지 않고 리포트로만 표시합니다. Aconex 정본(회신코드·회신일·Latest Status)은 대상에서
            제외됩니다.
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
              파일 선택
            </Button>
            <Button onClick={onPreview} disabled={!payload || busy !== null}>
              {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              미리보기 (Diff)
            </Button>
            <Button variant="default" onClick={onApply} disabled={!preview || busy !== null || guardBlocked}>
              {busy === "apply" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              반영
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
              <Badge variant={parsed.skipped_rows > 0 ? "destructive" : "outline"}>
                건너뜀 {parsed.skipped_rows}행
              </Badge>
              <Badge variant="outline">단계 컬럼 {parsed.present_stage_fields.length}개</Badge>
              <Badge variant="outline">아이템 컬럼 {parsed.present_item_fields.length}개</Badge>
              {parsed.unknown_headers.length > 0 && (
                <Badge variant="destructive">미인식 헤더 {parsed.unknown_headers.length}</Badge>
              )}
            </div>
          )}

          {scope && <ScopeSummary scope={scope} />}

          {parsed && parsed.unknown_headers.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>카탈로그에 없는 헤더</AlertTitle>
              <AlertDescription className="text-xs">{parsed.unknown_headers.join(", ")}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {view && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Diff 요약</CardTitle>
              <CardDescription>
                컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도. 모든 변경은 change_log 에 기록됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Stat label="총 행" value={view.total} />
                <Stat label="매칭" value={view.matched} />
                <Stat label="신규 생성" value={view.created} tone={view.created > 0 ? "warn" : undefined} />
                <Stat label="갱신" value={view.rows_changed} />
                <Stat label="값 삭제" value={view.cleared_values} tone={view.cleared_values > 0 ? "warn" : undefined} />
              </div>

              {view.applied && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="pending_hdec" value={view.integrity.pending_hdec} />
                  <Stat label="pending R1" value={view.integrity.pending_hdec_r1} />
                  <Stat label="pending R2" value={view.integrity.pending_hdec_r2} />
                  <Stat
                    label="위반"
                    value={view.integrity.violation}
                    tone={view.integrity.violation > 0 ? "warn" : undefined}
                  />
                </div>
              )}

              {view.delete_guard.tripped && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>삭제 규모 가드 작동</AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <div>
                      값 삭제 {view.cleared_values}건 — 임계 {view.delete_guard.pct}% 또는 {view.delete_guard.min_count}건
                      초과. 의도한 삭제인지 확인 후 승인해야 반영됩니다.
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox checked={allowDeletes} onCheckedChange={(v) => setAllowDeletes(v === true)} />
                      <span>삭제를 승인하고 반영합니다</span>
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {view.created > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>신규 생성 {view.created}건 — 파일에만 있는 번호</AlertTitle>
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
              <CardTitle className="text-base">행 단위 로그</CardTitle>
              <CardDescription>변경/미매칭 행만 표시 (최대 300행). 전체 이력은 Import Log 에 저장됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left">
                      <th className="w-20">Row</th>
                      <th className="w-64">WRT NUMBER</th>
                      <th className="w-24">결과</th>
                      <th>변경 내역</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.diff_rows.map((d) => (
                      <tr key={`${d.sheet_name}-${d.excel_row}`} className="border-t align-top">
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.sheet_name} r{d.excel_row}
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">{d.wrt_number}</td>
                        <td className="px-2 py-1">
                          <Badge
                            variant={d.outcome === "created" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
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
                          변경 사항이 없습니다.
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

export function ScopeSummary({ scope }: { scope: ImportScopeOutcome<any> }) {
  const denied = scope.deniedKeys;
  return (
    <Alert variant={denied.length > 0 ? "default" : "default"}>
      {denied.length > 0 ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
      <AlertTitle className="text-sm">
        임포트 범위 판정 (역할 {scope.role}) — 대상 {scope.allowedRows.length.toLocaleString()}행 / 제외{" "}
        {denied.length.toLocaleString()}행
      </AlertTitle>
      <AlertDescription className="text-xs">
        {denied.length === 0 ? (
          "전 행이 권한 범위 안입니다."
        ) : (
          <>
            <div className="mb-1">권한 범위 밖 행은 서버 판정에 따라 전송 자체에서 제외됩니다.</div>
            <div className="max-h-24 overflow-auto font-mono text-[10px] leading-relaxed">
              {denied.join(", ")}
            </div>
          </>
        )}
      </AlertDescription>
    </Alert>
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