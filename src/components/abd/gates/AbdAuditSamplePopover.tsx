import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pickAbdAuditSample } from "@/lib/abd/mf-audit.functions";
import { useAbdSettingsQuery } from "@/components/abd/dashboard/AbdAgingSettingsPopover";

/** §6.3 무작위 + 위험기반 표본선정 실행 (Manager/Engineer 전용) */
export function AbdAuditSamplePopover({ team }: { team?: string }) {
  const qc = useQueryClient();
  const pickFn = useServerFn(pickAbdAuditSample);
  const settings = useAbdSettingsQuery();
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(10);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const v = (settings.data as any)?.audit_sample_ratio;
    if (typeof v === "number") setRatio(v);
  }, [settings.data]);

  async function run() {
    setRunning(true);
    try {
      const res = (await pickFn({ data: { team, ratio, saveRatio: true } })) as {
        pool: number; target: number; selected: number; risk_selected: number;
      };
      toast.success(
        `표본선정 완료 — 모집단 ${res.pool} · 목표 ${res.target} · 선정 ${res.selected}(위험기반 ${res.risk_selected})`,
      );
      await qc.invalidateQueries({ queryKey: ["abd"] });
      await qc.invalidateQueries({ queryKey: ["abd-settings"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(`선정 실패: ${e?.message ?? e}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5" /> Audit 표본
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="text-sm font-semibold">표본감사 대상 선정</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          MF 확인이 완료된 미감사 도면 중 위험조건 해당 도면을 우선 선정하고, 남은 수량을 무작위로 채웁니다.
        </p>
        <div className="mt-3 space-y-2">
          <Label className="text-[11px]">표본 비율 (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            className="h-8 text-xs"
            value={ratio}
            onChange={(e) => setRatio(Number(e.target.value))}
          />
          <Button size="sm" className="w-full h-8 text-xs" disabled={running} onClick={() => void run()}>
            {running ? "선정 중…" : `${team ?? "전체"} 대상 선정 실행`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}