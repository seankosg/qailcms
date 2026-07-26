import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_THRESHOLDS,
  computeJudgment,
  type TaskThresholds,
} from "@/lib/task-management/derived";
import { AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import { saveTaskThresholds } from "@/lib/task-management/settings.functions";
import { runRecalcAutoJudgment } from "@/lib/task-management/rollup.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/task-thresholds")({
  head: () => ({ meta: [{ title: "Admin — Task Thresholds" }] }),
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const save = useServerFn(saveTaskThresholds);
  const recalcAll = useServerFn(runRecalcAutoJudgment);

  const { data: settings } = useQuery({
    queryKey: ["task-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      return data ?? DEFAULT_THRESHOLDS;
    },
  });

  const { data: rows = [] } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ["task-preview-rows"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("actual_progress, plan_start, plan_end, slip_days, level")
        .eq("level", "child")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const [t, setT] = useState<TaskThresholds>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setT({
        caution_gap_buffer: Number(
          (settings as any).caution_gap_buffer ?? DEFAULT_THRESHOLDS.caution_gap_buffer,
        ),
        worsen_gap: Number(
          (settings as any).worsen_gap ?? DEFAULT_THRESHOLDS.worsen_gap,
        ),
      });
    }
  }, [settings]);

  const preview = useMemo(() => {
    const counts: Record<string, number> = { 정상: 0, 주의: 0, 지연: 0, 악화: 0, 완료: 0 };
    for (const r of rows) {
      const j = computeJudgment(r as any, t);
      counts[j] = (counts[j] ?? 0) + 1;
    }
    return counts;
  }, [rows, t]);

  async function handleSave(recalc: boolean) {
    setSaving(true);
    try {
      await save({ data: t });
      toast.success("임계값 저장 완료");
      if (recalc) {
        const res = await recalcAll({ data: {} });
        toast.success(`전체 재계산 완료: ${res.updated}행`);
        qc.invalidateQueries({ queryKey: ["task-management-raw"] });
      }
      qc.invalidateQueries({ queryKey: ["task-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin — Task Auto‑Judgment 임계값
        </h1>
        <p className="text-sm text-muted-foreground">
          자동 판정(완료/정상/주의/지연/악화)의 경계값을 조정합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">임계값</CardTitle>
          <CardDescription>
            gap = 실적 진도율 − 오늘 계획 진도율. slip은 예상 완료가 계획 대비 초과된 일수.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-sm">주의 여유 임계치 (caution_gap_buffer)</Label>
            <Input
              type="number"
              step="0.01"
              value={t.caution_gap_buffer}
              onChange={(e) => setT({ ...t, caution_gap_buffer: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0 ≤ gap {"<"} 이 값 이면 "주의" (지연 임박). 기본 +0.05 (5%p 여유).
            </p>
          </div>
          <div>
            <Label className="text-sm">악화 경계 (worsen_gap)</Label>
            <Input
              type="number"
              step="0.01"
              value={t.worsen_gap}
              onChange={(e) => setT({ ...t, worsen_gap: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              gap {"<"} 이 값 이면 "악화" (심각 지연). 기본 -0.15 (-15%p).
            </p>
          </div>
          <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div><b>판정 축</b>: gap = Actual% − Cum.Plan%</div>
            <div>· <b>완료</b>: Actual ≥ 100%</div>
            <div>· <b>정상</b>: gap ≥ caution_gap_buffer (또는 미착수·기한 전)</div>
            <div>· <b>주의</b>: 0 ≤ gap {"<"} caution_gap_buffer</div>
            <div>· <b>지연</b>: gap {"<"} 0 (또는 미착수인데 plan_start 도래)</div>
            <div>· <b>악화</b>: gap {"<"} worsen_gap</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">현재 데이터 미리보기</CardTitle>
          <CardDescription>
            자식 행 {rows.length.toLocaleString()}개를 위 임계값으로 판정한 결과 (즉시 계산, 저장 전).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(["완료", "정상", "주의", "지연", "악화"] as const).map((k) => (
              <Badge
                key={k}
                className={cn(
                  "px-3 py-1 text-sm",
                  AUTO_JUDGMENT_COLORS[k] ?? "bg-muted",
                )}
              >
                {k}: {(preview[k] ?? 0).toLocaleString()}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={() => handleSave(false)} disabled={saving} variant="outline">
          {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />} 저장
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />} 저장 + 전체 재계산
        </Button>
      </div>
    </div>
  );
}