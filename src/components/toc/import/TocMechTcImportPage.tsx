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
import { parseMechTcFile, type ParsedMechFile } from "@/lib/toc/mech-tc-parser";
import { importTocMechTc, type MechTcResult } from "@/lib/toc/mech-tc-import.functions";

/**
 * 설비 T&C 잔여 파일로 인계(TOC) 현황 갱신.
 * 흐름: 파일 선택(파싱) → 미리보기(변경 대비) → 반영.
 * 미연결 조합은 접지 않고 전부 노출하며, "이 항목들 없이 진행" 승인 없이는 반영이 활성화되지 않는다.
 */
export function TocMechTcImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedMechFile | null>(null);
  const [preview, setPreview] = useState<MechTcResult | null>(null);
  const [result, setResult] = useState<MechTcResult | null>(null);
  const [busy, setBusy] = useState<null | "parse" | "preview" | "apply">(null);
  const [acceptUnlinked, setAcceptUnlinked] = useState(false);

  const run = useServerFn(importTocMechTc);

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
        source_description: r.source_description,
        status_raw: r.status_raw,
        is_closed: r.is_closed,
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
      const p = await parseMechTcFile(file);
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
          <CardTitle className="text-base">설비 T&amp;C 잔여 파일 갱신</CardTitle>
          <CardDescription>
            잔여 작업 표(<code>Remaining Works Status</code> 시트)에서 Status 가 Closed 면 T&amp;C 완료로, Open 이면 수량
            기준 가장 낮은 단계(Code-C 수량이 있으면 반려)로 현재 상태를 정합니다. 종료목표일은 TARGET DATE 를 쓰고,
            공란이면 기존 값을 유지합니다. 파일에 없는 설비 항목은 T&amp;C 완료로 처리하되 날짜는 만들지 않습니다. 이름
            연결은{" "}
            <Link to="/closure/toc/mech-map" className="underline">
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

      {parsed && (
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
            {parsed.inconsistent.length > 0 && (
              <div>
                <div className="font-medium">모순 행 (원문 그대로 노출)</div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {parsed.inconsistent.slice(0, 50).map((x, i) => (
                    <li key={i}>
                      {x.excel_row}행 · {x.source} — {x.message}
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
              계획일 변경 {shown.plan_changed}건 · T&amp;C 완료 처리 {shown.tac_completed}건 · 파일에 없어 T&amp;C 완료{" "}
              {shown.completed_by_absence}건
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              항등식 — 파싱 {shown.identity.parsed} = 반영 {shown.identity.applied_rows} + 변경없음 {shown.identity.unchanged} +
              미연결 {shown.identity.unlinked} + 거부 {shown.identity.rejected} + 미분류 {shown.identity.unclassified}
            </div>

            {shown.completed_by_absence > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>파일에 없어 T&amp;C 완료로 기록되는 항목 {shown.completed_by_absence}건</AlertTitle>
                <AlertDescription>
                  <ScrollArea className="mt-2 max-h-40">
                    <ul className="list-disc pl-5">
                      {shown.completed_list.map((k) => (
                        <li key={k}>{k}</li>
                      ))}
                    </ul>
                  </ScrollArea>
                </AlertDescription>
              </Alert>
            )}

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
