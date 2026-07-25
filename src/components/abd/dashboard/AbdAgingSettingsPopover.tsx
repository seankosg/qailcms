import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getAbdSettings, updateAbdSettings, type AbdSettings } from "@/lib/abd/settings.functions";

export function useAbdSettingsQuery() {
  const fn = useServerFn(getAbdSettings);
  return useQuery<AbdSettings | null>({
    queryKey: ["abd-settings"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function AbdAgingSettingsPopover() {
  const { data: user } = useCurrentUser();
  const canEdit = !!user && (user.isAdmin || user.isDSuperUser);
  const qc = useQueryClient();
  const settingsQ = useAbdSettingsQuery();
  const updateFn = useServerFn(updateAbdSettings);

  const [warn, setWarn] = useState<number>(3);
  const [late, setLate] = useState<number>(7);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (settingsQ.data) {
      setWarn(settingsQ.data.ur_aging_warn_days);
      setLate(settingsQ.data.ur_aging_late_days);
    }
  }, [settingsQ.data]);

  const s = settingsQ.data;

  async function save() {
    if (!canEdit) return;
    if (warn > late) {
      toast.error("Warn 값은 Late 값보다 작거나 같아야 합니다.");
      return;
    }
    setSaving(true);
    try {
      await updateFn({ data: { id: s?.id, ur_aging_warn_days: warn, ur_aging_late_days: late } });
      await qc.invalidateQueries({ queryKey: ["abd-settings"] });
      await qc.invalidateQueries({ queryKey: ["abd-dash-attention"] });
      toast.success("UR Aging 임계값이 저장되었습니다.");
      setOpen(false);
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-normal">
          <Settings2 className="h-4 w-4" />
          Aging: {s ? `${s.ur_aging_warn_days}d / ${s.ur_aging_late_days}d` : "…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-1">
          <div className="text-sm font-semibold">UR Aging 임계값</div>
          <p className="text-[11px] text-muted-foreground">
            Under Review 경과일에 따라 Attention·Raw Data 배지 색을 결정합니다.
          </p>
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="abd-aging-warn" className="text-xs">Warn (일)</Label>
              <Input
                id="abd-aging-warn"
                type="number"
                min={0}
                max={365}
                value={warn}
                disabled={!canEdit}
                onChange={(e) => setWarn(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="abd-aging-late" className="text-xs">Late (일)</Label>
              <Input
                id="abd-aging-late"
                type="number"
                min={0}
                max={365}
                value={late}
                disabled={!canEdit}
                onChange={(e) => setLate(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                className="h-8"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> &lt; {warn}d
              <span className="mx-1">·</span>
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> ≥ {warn}d
              <span className="mx-1">·</span>
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> ≥ {late}d
            </span>
          </div>
          {canEdit ? (
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>취소</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</Button>
            </div>
          ) : (
            <p className="pt-1 text-[11px] text-muted-foreground">
              읽기 전용 — 편집은 관리자만 가능합니다.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** ur_aging_days 값을 임계값 기준 톤으로 매핑 */
export function agingTone(days: number | null | undefined, settings: AbdSettings | null | undefined):
  "muted" | "ok" | "warn" | "danger" {
  if (days == null || days < 0) return "muted";
  const warn = settings?.ur_aging_warn_days ?? 3;
  const late = settings?.ur_aging_late_days ?? 7;
  if (days >= late) return "danger";
  if (days >= warn) return "warn";
  return "ok";
}

export const AGING_TONE_CLASS: Record<"muted" | "ok" | "warn" | "danger", string> = {
  muted: "bg-muted text-muted-foreground",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
};