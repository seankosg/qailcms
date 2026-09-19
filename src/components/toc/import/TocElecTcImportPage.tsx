import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { parseElecTcFile, type ParsedElecFile } from "@/lib/toc/elec-tc-parser";
import { importTocElecTc, type ElecTcResult } from "@/lib/toc/elec-tc-import.functions";

/**
 * 전기 T&C 잔여 파일로 인계(TOC) 현황 갱신.
 * 흐름: 파일 선택(파싱) → 미리보기(변경 대비) → 반영.
 * 미연결 조합은 접지 않고 전부 노출하며, "이 항목들 없이 진행" 승인 없이는 반영이 활성화되지 않는다.
 */
export function TocElecTcImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedElecFile | null>(null);
  const [preview, setPreview] = useState<ElecTcResult | null>(null);
  const [result, setResult] = useState<ElecTcResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "apply">(null);
  const [acceptUnlinked, setAcceptUnlinked] = useState(false);

  const run = useServerFn(importTocElecTc);

  const payload = useMemo(() => {
    if (!parsed) return null;
    return {
      file_name: parsed.file_name,
      sheet_name: parsed.sheet_name,
      plot: "D" as const,
      rows: parsed.rows.map((r) => ({
        sheet_name: r.sheet_name,
        excel_row: r.excel_row,
        source_system: r.source_system,
        source_sub: r.source_sub,
        source_description: r.source_description,
        status_raw: r.status_raw,
        toc_status: r.toc_status,
        target_finish: r.target_finish,
      })),
    };
  }, [parsed]);

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy("parse");
    setParsed(null);
    setPreview(null);
    setResult(null);
    setAcceptUnlinked(false);
    try {
      const p = await parseElecTcFile(file);
      setParsed(p);
      toast.success(`파싱 완료 — ${p.rows.length}건 (시트 "${p.sheet_name}")`);
    } catch (e: any) {
      toast.error(e?.message ?? "파일을 읽지 못했습니다");
    } finally {
      setBusy(null);
    }
  }

  async function onPreview() {
    if (!payload) return;
    setBusy("preview");
    try {
      const res = await run({ data: { ...payload, apply: false, accept_unlinked: false } });
      setPreview(res);
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
      const res = await run({
        data: {
          ...payload,
          apply: true,
          accept_unlinked: acceptUnlinked,
          scope_note: acceptUnlinked ? "accepted_unlinked_by_user=yes" : undefined,
        },
      });
      setResult(res);
      toast.success(`반영 완료 — 항목 ${res.items_updated}건 / 단계 ${res.stages_upserted}건 (${res.status})`);
    } catch (e: any) {
      toast.error(e?.message ?? "반영 실패");
    } finally {
      setBusy(null);
    }
  }

  const shown = result ?? preview;
  const blockedByUnlinked = (preview?.unlinked ?? 0) > 0 && !acceptUnlinked;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">전기 T&amp;C 잔여 파일 갱신</CardTitle>
          <CardDescription>
            잔여 작업 표(<code>Detail Status</code> 시트)의 Status 로 현재 상태를, 숫자가 들어 있는 Completion 열 중
            가장 늦은 날짜로 T&amp;C 완료 계획일을 갱신합니다. 파일에 없는 전기 항목은 T&amp;C 완료로 처리하되 날짜는
            만들지 않습니다. 이름 연결은{" "}
            <Link to="/closure/toc/elec-map" className="underline">
              대응표
            </Link>
            만 근거로 사용합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "parse" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            파일 선택
          </Button>
          <Button onClick={onPreview} disabled={!payload || busy !== null}>
            {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            미리보기
          </Button>
          <Button onClick={onApply} disabled={!preview || blockedByUnlinked || busy !== null}>
            {busy === "apply" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            반영
          </Button>
          {parsed && (
            <span className="text-sm text-muted-foreground">
              {parsed.file_name} · 시트 {parsed.sheet_name} · {parsed.rows.length}건
            </span>
          )}
        </CardContent>
      </Card>

      {parsed && (parsed.unmapped_headers.length > 0 || parsed.unknown_status_tokens.length > 0 || parsed.skipped.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">파일 점검</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              읽은 행 {parsed.total_scanned}건 → 사용 {parsed.rows.length}건
              {parsed.skipped.map((s) => (
                <span key={s.reason} className="ml-2 text-muted-foreground">
                  {s.reason} {s.count}건
                </span>
              ))}
            </div>
            {parsed.unmapped_headers.length > 0 && (
              <div>
                <div className="font-medium">미매핑 열 (임포트 제외)</div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {parsed.unmapped_headers.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {parsed.unknown_status_tokens.length > 0 && (
              <div>
                <div className="font-medium">해석하지 못한 Status 값 (무시)</div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {parsed.unknown_status_tokens.map((t) => (
                    <li key={t.token}>
                      "{t.token}" — {t.count}건 (예: {t.samples.join(" / ")})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {shown && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {result ? "반영 결과" : "미리보기"}{" "}
              <Badge variant={shown.status === "success" ? "default" : shown.status === "preview" ? "secondary" : "destructive"}>
                {shown.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              파일 {shown.total}건 · 연결 {shown.linked}건 · 미연결 {shown.unlinked}건 · 상태 변경 {shown.status_changed}건 ·
              계획일 변경 {shown.plan_changed}건 · 파일에 없어 T&amp;C 완료 {shown.completed_by_absence}건
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              항등식 — 파싱 {shown.identity.parsed} = 반영 {shown.identity.applied_rows} + 변경없음 {shown.identity.unchanged} +
              미연결 {shown.identity.unlinked} + 거부 {shown.identity.rejected} + 미분류 {shown.identity.unclassified}
            </div>

            {shown.unlinked > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>미연결 {shown.unlinked}건</AlertTitle>
                <AlertDescription>
                  <ScrollArea className="mt-2 max-h-48">
                    <ul className="list-disc pl-5">
                      {shown.unlinked_list.map((u, i) => (
                        <li key={`${u.excel_row}-${i}`}>
                          {u.excel_row}행 · {u.source} {u.status_raw ? `· status="${u.status_raw}"` : ""}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                  {!result && (
                    <label className="mt-3 flex items-center gap-2">
                      <Checkbox checked={acceptUnlinked} onCheckedChange={(v) => setAcceptUnlinked(v === true)} />
                      이 항목들 없이 진행합니다 (선택 내용은 임포트 로그에 남습니다)
                    </label>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {shown.diff_rows.length > 0 && (
              <div>
                <div className="font-medium">변경 대비 (최대 300건)</div>
                <ScrollArea className="mt-2 max-h-80 rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left">항목</th>
                        <th className="p-2 text-left">원문</th>
                        <th className="p-2 text-left">변경</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.diff_rows.map((d, i) => (
                        <tr key={`${d.item_key}-${i}`} className="border-t">
                          <td className="p-2 align-top">{d.item_key ?? "—"}</td>
                          <td className="p-2 align-top text-muted-foreground">{d.source}</td>
                          <td className="p-2 align-top">
                            {d.outcome === "unlinked"
                              ? "미연결"
                              : d.changes.map((c, j) => (
                                  <div key={j}>
                                    {c.target} · {c.field}: {c.previous ?? "(없음)"} → {c.next ?? "(없음)"}
                                  </div>
                                ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </div>
            )}

            {shown.rejected.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>거부 {shown.rejected.length}건</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {shown.rejected.slice(0, 50).map((r, i) => (
                      <li key={i}>
                        {r.key} — [{r.reason_code}] {r.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
