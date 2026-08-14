// Step 4B — 브라우저 로컬 검증·교정 카드 (presentation + 브라우저 전용 로직).
// DB·Storage·서버 staging 을 건드리지 않는다. 검증식은 ocs-local-validation.ts 하나만 쓴다.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldCheck } from "lucide-react";
import { type BaselineRead } from "@/lib/abd/ocs-baseline-reader";
import {
  buildLocalValidationReceipt,
  validateIncrementLocally,
  BASELINE_V1_NOTICE,
  type LocalValidationReceipt,
  type LocalValidationIssue,
  type LocalValidationResult,
} from "@/lib/abd/ocs-local-validation";
import { commentLocator, type CorrectionItem } from "@/lib/abd/ocs-local-corrections";
import { sourceHashByName } from "@/lib/abd/ocs-local-validation";
import { buildCorrectedPackage } from "@/lib/abd/ocs-corrected-package";
import type { IncrementPackage } from "@/lib/abd/ocs-increment-package";

type Props = {
  file: File | null;
  pkg: IncrementPackage | null;
  baseline: BaselineRead | null;
  /** Baseline ID 불일치 등으로 로컬 검증을 잠글 때 사유 */
  lockedReason?: string | null;
  onCleanChange: (state: {
    clean: boolean | null;
    blockerCount: number;
    receipt?: LocalValidationReceipt | null;
  }) => void;
};

const issueKey = (i: LocalValidationIssue) =>
  [i.code, i.source_file, i.sheet_name, i.source_row, i.sn, i.field, i.original_value].join("|");

export function OcsLocalValidationCard({
  file,
  pkg,
  baseline,
  lockedReason,
  onCleanChange,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<LocalValidationResult | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);

  // 파일(Baseline 또는 Increment)이 바뀌면 로컬 검증 결과·교정 선택만 초기화한다.
  useEffect(() => {
    setResult(null);
    setChoices({});
    setConfirmed({});
    setDownloaded(null);
  }, [file, baseline]);

  const mappable = useMemo(
    () => (result?.issues ?? []).filter((i) => i.correction_mode === "inline_mapping"),
    [result],
  );
  const manualOnly = useMemo(
    () => (result?.issues ?? []).filter((i) => i.correction_mode !== "inline_mapping"),
    [result],
  );

  const readyCorrections: CorrectionItem[] = useMemo(() => {
    if (!pkg || !result) return [];
    const nameToHash = sourceHashByName(pkg);
    const byId = new Map(pkg.atomic.comments.map((c) => [c.source_comment_id, c]));
    const out: CorrectionItem[] = [];
    for (const i of mappable) {
      const k = issueKey(i);
      const after = choices[k];
      if (!after || !confirmed[k] || !i.original_value) continue;
      const cand = i.candidates.find((c) => c.abd_number === after);
      const c = i.sn ? byId.get(i.sn) : undefined;
      if (!cand || !c) continue;
      out.push({
        ...commentLocator(c, nameToHash),
        field: "abd_number",
        before: i.original_value,
        after: cand.abd_number,
        after_abd_item_id: cand.abd_item_id,
        reason: "user_selected_canonical_mapping",
      });
    }
    return out;
  }, [mappable, choices, confirmed, pkg, result]);

  async function runValidation() {
    if (!pkg || !baseline) return;
    setBusy("로컬 검증 중…");
    try {
      const r = validateIncrementLocally({ pkg, baseline });
      setResult(r);
      setChoices({});
      setConfirmed({});
      const receipt = r.clean
        ? await buildLocalValidationReceipt({
            pkg,
            result: r,
            corrections: null,
            manifestForPayload: pkg.manifest,
          })
        : null;
      onCleanChange({ clean: r.clean, blockerCount: r.blocker_count, receipt });
      if (r.clean) toast.success("CLEAN — 로컬 검증 blocker 0건");
      else toast.error(`로컬 검증 blocker ${r.blocker_count}건`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadCorrected() {
    if (!file || !pkg || !baseline || readyCorrections.length === 0) return;
    setBusy("교정본 생성 중…");
    try {
      const built = await buildCorrectedPackage({
        originalFile: file,
        pkg,
        corrections: readyCorrections,
        baselineId: baseline.baseline_id,
        revision,
        receiptOf: async (manifest, corrections) => {
          const r = validateIncrementLocally({ pkg, baseline, corrections });
          return buildLocalValidationReceipt({
            pkg,
            result: r,
            corrections,
            manifestForPayload: manifest,
          });
        },
      });
      const url = URL.createObjectURL(built.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = built.file_name;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(built.file_name);
      setRevision((n) => n + 1);
      toast.success(`교정본 저장 — ${built.file_name} (교정 ${built.applied}건)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!pkg) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">로컬 검증 (서버 업로드 전)</CardTitle>
          <CardDescription>먼저 증분 ZIP 을 선택하십시오.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> 로컬 검증 · 교정 (내 컴퓨터에서만 실행)
        </CardTitle>
        <CardDescription>
          이 단계에서는 서버·데이터베이스·저장소를 전혀 변경하지 않습니다. 오류를 먼저 확인하고
          안전한 항목만 교정한 뒤, 교정본 ZIP 을 다시 검증해 CLEAN 판정을 받으십시오.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium">1) Baseline ZIP 선택</label>
          <input
            type="file"
            accept=".zip"
            className="text-sm"
            onChange={(e) => void onPickBaseline(e.target.files)}
          />
          {baseline && (
            <Badge variant="outline">
              {baseline.schema_version} · ABD {baseline.abdIndex?.length ?? 0}건
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void runValidation()}
            disabled={!baseline || !baseline.abdIndex || !!busy}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Check This Package on My Computer
          </Button>
          {result && (
            <>
              <Badge variant={result.clean ? "default" : "destructive"}>
                {result.clean ? "CLEAN" : `Blockers ${result.blocker_count}`}
              </Badge>
              <span className="text-xs text-muted-foreground">
                코멘트 {result.counts.comments} · 미해소 ABD {result.unresolved_abd_count} · 중복
                identity {result.duplicate_identity_count}
              </span>
            </>
          )}
        </div>

        {baseline && !baseline.abdIndex && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
            <p className="whitespace-pre-line">{BASELINE_V1_NOTICE}</p>
          </div>
        )}

        {result && result.clean && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            로컬 검증을 통과했습니다. 이제 서버 Preflight 로 진행할 수 있습니다.
          </div>
        )}

        {mappable.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> 브라우저에서 교정 가능한 항목
              {mappable.length}건 (ABD Number 매핑)
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">원본 파일 / 행</th>
                    <th className="p-2">S/N</th>
                    <th className="p-2">입력값</th>
                    <th className="p-2">canonical 선택</th>
                    <th className="p-2">확인</th>
                  </tr>
                </thead>
                <tbody>
                  {mappable.map((i) => {
                    const k = issueKey(i);
                    return (
                      <tr key={k} className="border-t align-top">
                        <td className="p-2">
                          {i.source_file ?? "-"}
                          {i.sheet_name ? ` / ${i.sheet_name}` : ""}
                          {i.source_row !== null ? ` / row ${i.source_row}` : ""}
                        </td>
                        <td className="p-2">{i.sn ?? "-"}</td>
                        <td className="p-2 font-mono">{i.original_value}</td>
                        <td className="p-2">
                          {i.candidates.length > 0 ? (
                            <Select
                              value={choices[k] ?? ""}
                              onValueChange={(v) => setChoices((s) => ({ ...s, [k]: v }))}
                            >
                              <SelectTrigger className="h-8 w-64">
                                <SelectValue placeholder="canonical ABD 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {i.candidates.map((c) => (
                                  <SelectItem key={c.abd_item_id} value={c.abd_number}>
                                    {c.abd_number}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-muted-foreground">
                              후보 없음 — 원본 Excel 수정 필요
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <Checkbox
                            checked={confirmed[k] ?? false}
                            disabled={!choices[k]}
                            onCheckedChange={(v) =>
                              setConfirmed((s) => ({ ...s, [k]: v === true }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void downloadCorrected()}
                disabled={readyCorrections.length === 0 || !!busy}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Corrected Package ({readyCorrections.length})
              </Button>
              {downloaded && (
                <span className="text-xs text-muted-foreground">
                  저장됨: {downloaded} — 이 파일을 다시 선택해 CLEAN 을 확인하십시오.
                </span>
              )}
            </div>
          </div>
        )}

        {manualOnly.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              원본 Excel 수정이 필요한 항목 {manualOnly.length}건 (브라우저 교정 불가)
            </div>
            <div className="max-h-60 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">코드</th>
                    <th className="p-2">위치</th>
                    <th className="p-2">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {manualOnly.map((i, n) => (
                    <tr key={`${issueKey(i)}#${n}`} className="border-t align-top">
                      <td className="p-2 font-mono">{i.code}</td>
                      <td className="p-2">
                        {i.source_file ?? "-"}
                        {i.source_row !== null ? ` / row ${i.source_row}` : ""}
                        {i.sn ? ` / ${i.sn}` : ""}
                      </td>
                      <td className="p-2">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
