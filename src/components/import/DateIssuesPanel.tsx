import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DateIssue } from "@/lib/import/date-audit";
import { strictParseDateValue } from "@/lib/import/date-audit";

interface Props {
  fileName: string;
  sheetName?: string | null;
  issues: DateIssue[];
  currentOverrides?: Record<string, string>;
  onApply: (overrides: Record<string, string>) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * 임포트 파서가 감지한 날짜 오류 셀 목록.
 * 사용자에게 셀 주소·헤더·원본값·오류사유를 보여주고 인라인으로 수정 후
 * 재파싱을 요청한다. 권장값은 사전 입력해 준다.
 */
export function DateIssuesPanel({
  fileName,
  sheetName,
  issues,
  currentOverrides,
  onApply,
  disabled,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    // 새 issue 집합이 들어올 때: 기존 override 유지 + 권장값으로 채워둠.
    const next: Record<string, string> = { ...(currentOverrides ?? {}) };
    for (const it of issues) {
      if (next[it.cellRef] == null || next[it.cellRef] === "") {
        if (it.suggestion) next[it.cellRef] = it.suggestion;
      }
    }
    setDrafts(next);
  }, [issues, currentOverrides]);

  const invalidCount = useMemo(() => {
    let n = 0;
    for (const it of issues) {
      const v = drafts[it.cellRef];
      if (!v || !strictParseDateValue(v)) n++;
    }
    return n;
  }, [issues, drafts]);

  if (issues.length === 0) return null;

  const applyAllSuggestions = () => {
    const next: Record<string, string> = { ...drafts };
    for (const it of issues) {
      if (it.suggestion) next[it.cellRef] = it.suggestion;
    }
    setDrafts(next);
  };

  const handleApply = () => {
    const clean: Record<string, string> = {};
    for (const it of issues) {
      const v = drafts[it.cellRef];
      if (v && strictParseDateValue(v)) clean[it.cellRef] = v;
    }
    void onApply(clean);
  };

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
          <div>
            <div className="text-sm font-medium">
              날짜 형식 오류 {issues.length}건
              <span className="text-xs text-muted-foreground ml-2">
                {fileName}
                {sheetName ? ` · ${sheetName}` : ""}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              각 셀을 YYYY-MM-DD 형식으로 수정 후 "재파싱 적용"을 눌러 반영하세요. 권장값이 있는 경우 미리 채워져 있습니다.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={applyAllSuggestions}
            disabled={disabled}
          >
            <Wand2 className="h-3.5 w-3.5 mr-1" /> 권장값 일괄 채움
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={disabled || invalidCount > 0}
          >
            재파싱 적용{invalidCount > 0 ? ` (${invalidCount}건 미완)` : ""}
          </Button>
        </div>
      </div>

      <ScrollArea className="max-h-64">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-2 w-20">셀</th>
              <th className="py-1 pr-2 w-40">필드/헤더</th>
              <th className="py-1 pr-2 w-40">원본 값</th>
              <th className="py-1 pr-2">사유</th>
              <th className="py-1 pr-2 w-40">수정 값 (YYYY-MM-DD)</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((it) => {
              const v = drafts[it.cellRef] ?? "";
              const parsed = strictParseDateValue(v);
              const invalid = v.length > 0 && !parsed;
              return (
                <tr key={it.cellRef} className="border-t align-top">
                  <td className="py-1 pr-2 font-mono">{it.cellRef}</td>
                  <td className="py-1 pr-2">
                    <div className="font-medium">{it.field}</div>
                    <div className="text-muted-foreground truncate max-w-[160px]" title={it.header}>
                      {it.header}
                    </div>
                  </td>
                  <td className="py-1 pr-2 truncate max-w-[160px]" title={it.rawValue}>
                    {it.rawValue}
                  </td>
                  <td className="py-1 pr-2">
                    <div>{it.reason}</div>
                    {it.ambiguous && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        모호 — 확인 필요
                      </Badge>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={v}
                      placeholder="YYYY-MM-DD"
                      className={`h-7 text-xs ${invalid ? "border-destructive" : ""}`}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [it.cellRef]: e.target.value }))
                      }
                      disabled={disabled}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}