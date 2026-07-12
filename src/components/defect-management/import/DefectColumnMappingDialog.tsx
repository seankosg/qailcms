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
  DEFECT_TARGET_FIELDS,
  type DefectSheetHeader,
  type DefectTargetField,
} from "@/lib/defect-management/parser";

const FIELD_LABELS: Record<DefectTargetField, string> = {
  source_issue_no: "source_issue_no · ID",
  location_raw: "location_raw · Location",
  plan_title: "plan_title · PlanTitle",
  plan_group: "plan_group · PlanGroup",
  status_raw: "status_raw · Status",
  assigned_to: "assigned_to · AssignedTo",
  category: "category · Category",
  defect_type: "defect_type · Type",
  item: "item · Item",
  description: "description · Description",
  priority: "priority · Priority",
  due_by: "due_by · DueBy",
  created_by_name: "created_by_name · CreatedBy",
  created_by_team_name: "created_by_team_name · CreatedByTeamName",
  created_date: "created_date · CreatedDate",
  ir: "ir · IR",
  forms: "forms · Forms",
  last_updated_at: "last_updated_at · LastUpdated",
  updated_description: "updated_description · UpdatedDescription",
  updated_by_name: "updated_by_name · UpdatedBy",
  updated_status: "updated_status · UpdatedStatus",
  updated_date_raw: "updated_date_raw · UpdatedDate",
  location_reference: "location_reference · LocationReference",
  classification: "classification · Classification",
  podium_area: "podium_area · Podium area",
};

export interface DefectColumnMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  sheetHeaders: DefectSheetHeader[];
  currentMap: Record<string, number>;
  defaultMap: Record<string, number>;
  onApply: (
    overrides: Partial<Record<DefectTargetField, number>> | null,
  ) => Promise<void> | void;
}

function buildDraft(map: Record<string, number>): Record<DefectTargetField, number> {
  const out = {} as Record<DefectTargetField, number>;
  for (const f of DEFECT_TARGET_FIELDS) out[f] = map[f] ?? 0;
  return out;
}

export function DefectColumnMappingDialog({
  open,
  onClose,
  fileName,
  sheetHeaders,
  currentMap,
  defaultMap,
  onApply,
}: DefectColumnMappingDialogProps) {
  const [draft, setDraft] = useState<Record<DefectTargetField, number>>(() => buildDraft(currentMap));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(buildDraft(currentMap));
  }, [open, currentMap]);

  const apply = async () => {
    setSaving(true);
    try {
      const overrides: Partial<Record<DefectTargetField, number>> = {};
      let changed = 0;
      for (const key of DEFECT_TARGET_FIELDS) {
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>컬럼 매핑 — {fileName}</DialogTitle>
          <DialogDescription>
            엑셀 헤더가 자동 매핑되지 않은 필드만 조정하세요. 저장하면 재파싱됩니다.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-1">
            <div className="grid grid-cols-[240px_1fr_180px] items-center gap-2 border-b py-1 text-xs font-medium text-muted-foreground">
              <div>필드</div>
              <div>엑셀 컬럼 (행 1 헤더)</div>
              <div>미리보기 (2행)</div>
            </div>
            {DEFECT_TARGET_FIELDS.map((field) => {
              const value = draft[field];
              const sample = sheetHeaders.find((h) => h.col === value)?.sample;
              return (
                <div
                  key={field}
                  className="grid grid-cols-[240px_1fr_180px] items-center gap-2 py-1 text-xs"
                >
                  <div className="font-mono">
                    {FIELD_LABELS[field]}
                    {defaultMap[field] !== value && (
                      <span className="ml-1 text-amber-600">*</span>
                    )}
                  </div>
                  <Select
                    value={value ? String(value) : ""}
                    onValueChange={(v) => setDraft((d) => ({ ...d, [field]: Number(v) }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="컬럼 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0" className="text-xs">
                        (매핑 없음)
                      </SelectItem>
                      {sheetHeaders.map((h) => (
                        <SelectItem key={h.col} value={String(h.col)} className="text-xs">
                          {h.letter}
                          {h.header ? `: ${h.header}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="truncate text-muted-foreground">{sample ?? "-"}</div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => setDraft(buildDraft(defaultMap))} disabled={saving}>
            기본값 복원
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              취소
            </Button>
            <Button size="sm" onClick={apply} disabled={saving}>
              {saving ? "적용 중…" : "적용"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
