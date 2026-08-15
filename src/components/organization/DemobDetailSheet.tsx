/**
 * Demob Plan 행 상세 — 모듈별 최종일과 그 날짜를 만든 마지막 항목.
 * 정본 종결일 산식은 RPC `org_demob_plan()` 과 동일한 우선순위를 클라이언트에서 재적용한다.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDdMmmYyyy } from "@/lib/time/doha";
import {
  DEMOB_MODULES,
  MODULE_LABEL,
  MODULE_RAW_ROUTE,
  type DemobModule,
  type DemobRow,
} from "@/lib/organization/demob-types";

interface LastItem { module: DemobModule; no: string; title: string; date: string; field: string }

const maxOf = (pairs: Array<[string, string | null]>): { date: string; field: string } | null => {
  let best: { date: string; field: string } | null = null;
  for (const [field, d] of pairs) {
    if (!d) continue;
    const v = String(d).slice(0, 10);
    if (!best || v > best.date) best = { date: v, field };
  }
  return best;
};

async function fetchLastItems(pic: string): Promise<LastItem[]> {
  const out: LastItem[] = [];
  const push = (
    module: DemobModule,
    rows: any[],
    no: (r: any) => string,
    title: (r: any) => string,
    fields: string[],
  ) => {
    let best: { r: any; date: string; field: string } | null = null;
    for (const r of rows) {
      const m = maxOf(fields.map((f) => [f, r[f] ?? null] as [string, string | null]));
      if (m && (!best || m.date > best.date)) best = { r, date: m.date, field: m.field };
    }
    if (best) out.push({ module, no: no(best.r) ?? "", title: title(best.r) ?? "", date: best.date, field: best.field });
  };

  const [tm, sm, abd, spl, wrt] = await Promise.all([
    (supabase as any).from("task_management_raw")
      .select("task_no,task_name,actual_finish,forecast_end,plan_end")
      .eq("hdec_pic_name", pic).eq("is_active", true).limit(5000),
    (supabase as any).from("defect_items_raw")
      .select("issue_no,description,actual_ho_date,planned_ho_date,actual_closure_date,planned_closure_date")
      .eq("hdec_pic_name", pic).eq("is_active", true).limit(5000),
    (supabase as any).from("abd_items_raw")
      .select("abd_number,document_title,approval_date,r3_dar_actual,r3_dar_plan,r2_dar_actual,r2_dar_plan,r1_dar_actual,r1_dar_plan")
      .eq("hdec_pic_name", pic).eq("is_active", true).limit(5000),
    (supabase as any).from("spl_stage_progress")
      .select("stage_code,plan_finish,actual_finish,item:spl_items!inner(spl_number,title,pic,is_active,is_excluded)")
      .eq("item.pic", pic).limit(5000),
    (supabase as any).from("wrt_stage_progress")
      .select("stage_code,plan_finish,actual_finish,item:wrt_items!inner(wrt_number,title,pic,is_active,is_excluded)")
      .eq("item.pic", pic).limit(5000),
  ]);

  push("tm", tm.data ?? [], (r) => r.task_no, (r) => r.task_name, ["actual_finish", "forecast_end", "plan_end"]);
  push("sm", sm.data ?? [], (r) => r.issue_no, (r) => r.description,
    ["actual_ho_date", "planned_ho_date", "actual_closure_date", "planned_closure_date"]);
  push("abd", abd.data ?? [], (r) => r.abd_number, (r) => r.document_title,
    ["approval_date", "r3_dar_actual", "r3_dar_plan", "r2_dar_actual", "r2_dar_plan", "r1_dar_actual", "r1_dar_plan"]);
  push("spl", spl.data ?? [], (r) => r.item?.spl_number, (r) => `${r.item?.title ?? ""} (${r.stage_code})`,
    ["actual_finish", "plan_finish"]);
  push("wrt", wrt.data ?? [], (r) => r.item?.wrt_number, (r) => `${r.item?.title ?? ""} (${r.stage_code})`,
    ["actual_finish", "plan_finish"]);

  return out;
}

export function DemobDetailSheet({ row, onClose }: { row: DemobRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["demob-detail", row?.pic_name],
    enabled: !!row,
    staleTime: 60_000,
    queryFn: () => fetchLastItems(row!.pic_name),
  });

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {row?.pic_name}
            <Badge variant="secondary">{row?.team ?? "미지정"}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground">철수 예정일</div>
            <div className="text-2xl font-semibold tabular-nums">
              {row?.demob_date ? formatDdMmmYyyy(row.demob_date) : "-"}
            </div>
          </div>

          {DEMOB_MODULES.map((m) => {
            const cell = row?.per_module?.[m];
            const last = q.data?.find((x) => x.module === m);
            return (
              <div key={m} className="rounded border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{MODULE_LABEL[m]}</span>
                  <Link
                    to={MODULE_RAW_ROUTE[m]}
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={onClose}
                  >
                    Raw Data 열기
                  </Link>
                </div>
                {cell?.end ? (
                  <>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>시작 {cell.start ? formatDdMmmYyyy(cell.start) : "-"}</span>
                      <span className="font-medium text-foreground">종결 {formatDdMmmYyyy(cell.end)}</span>
                      <span>{cell.count}건</span>
                    </div>
                    <div className="mt-1">
                      {q.isLoading ? (
                        <Skeleton className="h-4 w-56" />
                      ) : last ? (
                        <span className="text-muted-foreground">
                          최종 항목: <span className="text-foreground">{last.no}</span> — {last.title}
                          <span className="ml-1 opacity-70">({last.field})</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">최종 항목 확인 불가</span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-muted-foreground">해당 없음</div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
