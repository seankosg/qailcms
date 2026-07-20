import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sliders } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_THRESHOLDS, type TaskThresholds } from "@/lib/task-management/derived";
import { saveTaskThresholds } from "@/lib/task-management/settings.functions";
import { runRecalcAutoJudgment } from "@/lib/task-management/rollup.functions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  TASK_SETTINGS_QUERY_KEY,
  useTaskManagementSettings,
} from "@/hooks/useTaskManagementSettings";

interface Props {
  /** 트리거 버튼 크기/스타일 변형 */
  triggerVariant?: "outline" | "ghost";
  triggerLabel?: string;
  compact?: boolean;
}

export function CriticalThresholdPopover({
  triggerVariant = "outline",
  triggerLabel = "임계값",
  compact = false,
}: Props) {
  const qc = useQueryClient();
  const { data: settings } = useTaskManagementSettings();
  const save = useServerFn(saveTaskThresholds);
  const recalc = useServerFn(runRecalcAutoJudgment);
  const { isAdmin } = useCurrentUser();

  const [open, setOpen] = useState(false);
  const [t, setT] = useState<TaskThresholds>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setT(settings);
  }, [settings]);

  async function handleSave(withRecalc: boolean) {
    setSaving(true);
    try {
      await save({ data: t });
      toast.success("임계값 저장 완료");
      if (withRecalc) {
        const res = await recalc({ data: {} });
        toast.success(`전체 재계산 완료: ${res.updated}행`);
        qc.invalidateQueries({ queryKey: ["task-management-raw"] });
      }
      qc.invalidateQueries({ queryKey: TASK_SETTINGS_QUERY_KEY });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
          className={compact ? "h-7 px-2 text-[11px]" : "h-8"}
          title="자동 판정 임계값 설정"
        >
          <Sliders className={compact ? "mr-1 h-3 w-3" : "mr-1 h-3.5 w-3.5"} />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-2">
          <div className="text-sm font-semibold">Auto‑Judgment 임계값</div>
          <p className="text-[11px] text-muted-foreground">
            gap = 실적 진도율 − 오늘 계획 진도율. slip은 예상 완료가 계획 대비 초과된 일수.
          </p>
        </div>
        <Separator className="my-3" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px]">주의 gap (&lt;)</Label>
            <Input
              type="number"
              step="0.01"
              className="h-8 text-xs"
              value={t.behind_warn_gap}
              onChange={(e) => setT({ ...t, behind_warn_gap: Number(e.target.value) })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <Label className="text-[11px]">위험 gap (&lt;)</Label>
            <Input
              type="number"
              step="0.01"
              className="h-8 text-xs"
              value={t.behind_late_gap}
              onChange={(e) => setT({ ...t, behind_late_gap: Number(e.target.value) })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <Label className="text-[11px]">지연 slip (&gt;일)</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={t.slip_warn_days}
              onChange={(e) => setT({ ...t, slip_warn_days: Number(e.target.value) })}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <Label className="text-[11px]">위험 slip (&gt;일)</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={t.slip_late_days}
              onChange={(e) => setT({ ...t, slip_late_days: Number(e.target.value) })}
              disabled={!isAdmin}
            />
          </div>
        </div>
        <Separator className="my-3" />
        {isAdmin ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 text-xs"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              저장
            </Button>
            <Button
              size="sm"
              className="h-8 flex-1 text-xs"
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              저장+재계산
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            수정은 관리자만 가능합니다.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}