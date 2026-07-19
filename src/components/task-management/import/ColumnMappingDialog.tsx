import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TASK_TARGET_FIELDS,
  type SheetHeaderEntry,
  type TaskTargetField,
} from "@/lib/task-management/parser";

const FIELD_LABELS: Record<TaskTargetField, string> = {
  task_no: "task_no · No",
  category: "category · Category",
  plot: "plot · Plot",
  task_name: "task_name · 항목",
  risk: "risk · 리스크",
  sub_task_desc: "sub_task_desc · 세부 업무",
  hdec_pic_name: "hdec_pic_name · HDEC PIC (한글)",
  hdec_eng_name: "hdec_eng_name · HDEC ENG (영문)",
  row_type: "row_type · 유형",
  status_manual: "status_manual · 상태",
  plan_start: "plan_start · 계획 시작",
  plan_end: "plan_end · 계획 완료",
  plan_days: "plan_days · 계획 일수",
  actual_start: "actual_start · 실제 시작",
  actual_progress: "actual_progress · 실적 진도율",
  plan_progress: "plan_progress · 계획 진도율",
  progress_variance: "progress_variance · 진도차",
  forecast_end: "forecast_end · 예상 완료",
  slip_days: "slip_days · 차이(일)",
  auto_judgment: "auto_judgment · 자동 판정",
};

export interface ColumnMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  sheetHeaders: SheetHeaderEntry[];
  currentMap: Record<string, number>;
  defaultMap: Record<string, number>;
  onApply: (
    overrides: Partial<Record<TaskTargetField, number>> | null,
  ) => Promise<void> | void;
}

export function ColumnMappingDialog({
  open,
  onClose,
  fileName,
  sheetHeaders,
  currentMap,
  defaultMap,
  onApply,
}: ColumnMappingDialogProps) {
  const [draft, setDraft] = useState<Record<TaskTargetField, number>>(() =>
    buildDraft(currentMap),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(buildDraft(currentMap));
  }, [open, currentMap]);

  const applyOverrides = async () => {
    setSaving(true);
    try {
      // 기본값과 다른 항목만 override로 전달
      const overrides: Partial<Record<TaskTargetField, number>> = {};
      let changed = 0;
      for (const key of TASK_TARGET_FIELDS) {
        const v = draft[key];
        if (v && v !== defaultMap[key]) {
          overrides[key] = v;
          changed++;
        }
      }
      await onApply(changed === 0 ? null : overrides);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setDraft(buildDraft(defaultMap));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>컬럼 매핑 — {fileName}</DialogTitle>
          <DialogDescription>
            엑셀 시트의 각 컬럼을 데이터베이스 필드에 매핑합니다. 자동 감지된 값에서 변경할 항목만 수정하세요.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-1">
            <div className="grid grid-cols-[220px_1fr_180px] items-center gap-2 border-b py-1 text-xs font-medium text-muted-foreground">
              <div>필드</div>
              <div>엑셀 컬럼 (행 5 헤더)</div>
              <div>미리보기 (7행)</div>
            </div>
            {TASK_TARGET_FIELDS.map((field) => {
              const value = draft[field];
              const sample = sheetHeaders.find((h) => h.col === value)?.sample;
              return (
                <div
                  key={field}
                  className="grid grid-cols-[220px_1fr_180px] items-center gap-2 py-1 text-xs"
                >
                  <div className="font-mono">
                    {FIELD_LABELS[field]}
                    {defaultMap[field] !== value && (
                      <span className="ml-1 text-amber-600">*</span>
                    )}
                  </div>
                  <Select
                    value={value ? String(value) : ""}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, [field]: Number(v) }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="컬럼 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {sheetHeaders.map((h) => (
                        <SelectItem
                          key={h.col}
                          value={String(h.col)}
                          className="text-xs"
                        >
                          {h.letter}
                          {h.header ? `: ${h.header}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="truncate text-muted-foreground">
                    {sample ?? "-"}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetToDefault}
            disabled={saving}
          >
            기본값 복원
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              취소
            </Button>
            <Button size="sm" onClick={applyOverrides} disabled={saving}>
              {saving ? "적용 중…" : "적용"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildDraft(map: Record<string, number>): Record<TaskTargetField, number> {
  const out = {} as Record<TaskTargetField, number>;
  for (const f of TASK_TARGET_FIELDS) out[f] = map[f] ?? 0;
  return out;
}