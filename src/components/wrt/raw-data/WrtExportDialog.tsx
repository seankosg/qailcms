import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { dohaStampCompact } from "@/lib/time/doha";
import { exportRowsToXlsx, copyRowsAsTsv } from "@/lib/abd/bulk-actions";
import type { WrtRow } from "@/lib/wrt/rows.functions";
import { WRT_COLUMNS } from "./wrt-columns";

type Format = "view" | "roundtrip";
type Axis = "none" | "team" | "plot" | "dis";

const AXIS_LABEL: Record<Exclude<Axis, "none">, string> = { team: "Team", plot: "Plot", dis: "DIS" };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 현재 필터 결과 */
  rows: WrtRow[];
  /** 화면 표시 컬럼 순서 */
  exportColumns: { key: string; label: string }[];
  /** 왕복 임포트 양식 — 기존 경로 그대로 */
  onRoundtrip: () => Promise<void>;
}

function ts() {
  const s = dohaStampCompact();
  return `${s.slice(0, 8)}_${s.slice(8)}`;
}

export function WrtExportDialog({ open, onOpenChange, rows, exportColumns, onRoundtrip }: Props) {
  const [format, setFormat] = useState<Format>("view");
  const [axis, setAxis] = useState<Axis>("none");
  const [busy, setBusy] = useState(false);

  const getByKey = new Map(WRT_COLUMNS.map((c) => [c.key, c] as const));
  const toRecord = (r: WrtRow) => {
    const out: Record<string, unknown> = {};
    for (const c of exportColumns) out[c.key] = getByKey.get(c.key)?.get(r) ?? "";
    return out;
  };

  const run = async () => {
    setBusy(true);
    try {
      if (format === "roundtrip") {
        await onRoundtrip();
        onOpenChange(false);
        return;
      }
      if (rows.length === 0) {
        toast.error("내보낼 행이 없습니다.");
        return;
      }
      const stamp = ts();
      if (axis === "none") {
        exportRowsToXlsx({ rows: rows.map(toRecord), columns: exportColumns, fileName: `CMS_WRT_view_${stamp}.xlsx` });
        toast.success(`${rows.length.toLocaleString()}건 내보내기 완료`);
      } else {
        const groups = new Map<string, WrtRow[]>();
        for (const r of rows) {
          const raw = (r as any)[axis];
          const key = raw != null && String(raw).trim() ? String(raw).trim() : "Unassigned";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        }
        for (const [key, rs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          exportRowsToXlsx({
            rows: rs.map(toRecord),
            columns: exportColumns,
            fileName: `CMS_WRT_view_${axis}-${key.replace(/[\\/:*?"<>|]/g, "_")}_${stamp}.xlsx`,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
        toast.success(`${groups.size}개 파일 다운로드`);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const res = await copyRowsAsTsv({ rows: rows.map(toRecord), columns: exportColumns });
    toast.success(`${res.rowCount}행 × ${res.colCount}열 복사됨`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export WRT Raw Data</DialogTitle>
          <DialogDescription>
            현재 필터 결과 <span className="font-medium tabular-nums">{rows.length.toLocaleString()}</span>행을 내보냅니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as Format)} className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="view" className="mt-1" />
                <span>View — 현재 표시 컬럼/라벨 그대로</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="roundtrip" className="mt-1" />
                <span>왕복 양식 — 재임포트용 표준 시트</span>
              </label>
            </RadioGroup>
          </div>
          {format === "view" && (
            <div>
              <Label className="text-xs">Output</Label>
              <RadioGroup value={axis} onValueChange={(v) => setAxis(v as Axis)} className="mt-2 flex flex-col gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="none" className="mt-1" />
                  <span>단일 파일</span>
                </label>
                {(Object.keys(AXIS_LABEL) as Array<keyof typeof AXIS_LABEL>).map((a) => (
                  <label key={a} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value={a} className="mt-1" />
                    <span>{AXIS_LABEL[a]} 별 분리</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={copy} disabled={busy || rows.length === 0}>
            TSV 복사
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}