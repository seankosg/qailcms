import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useMyTasks, useMyDefects, useMyAbd,
  tmIsCompleted, tmIsStarted, tmIsDelayed, tmIsUpcoming,
  smIsCompleted, smIsDelayed, smIsInProgress, smIsUpcoming,
  abdIsApproved, abdIsInProgress, abdIsDelayed, abdIsUpcoming, abdStage, abdCurrentPlanDate,
  today,
  type TmMyRow, type SmMyRow, type AbdMyRow,
} from "@/hooks/useMyWorkspaceData";
import { ModuleKpiCard, type KpiTone } from "./ModuleKpiCard";
import { ModuleRowList, type RowListTab } from "./ModuleRowList";
import { AbdDetailSheet } from "@/components/abd/raw-data/AbdDetailSheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dohaStamp } from "@/lib/time/doha";
import { ClipboardList, AlertTriangle, FileCheck2, ShieldAlert } from "lucide-react";

function fmtDate(d?: string | null): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
}

function judgmentTone(j: string | null | undefined): KpiTone {
  switch (j) {
    case "위험": return "destructive";
    case "지연": return "destructive";
    case "주의": return "warning";
    case "완료": return "success";
    default: return "muted";
  }
}

export function MyWorkSpacePage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const navigate = useNavigate();

  const isAdmin = !!me?.isAdmin;
  const pic = me?.hdec_pic_name ?? null;

  const tm = useMyTasks(pic, isAdmin);
  const sm = useMyDefects(pic, isAdmin);
  const abd = useMyAbd(pic, isAdmin);

  const [tmTab, setTmTab] = useState<RowListTab>("all");
  const [smTab, setSmTab] = useState<RowListTab>("all");
  const [abdTab, setAbdTab] = useState<RowListTab>("all");
  const [abdDetailId, setAbdDetailId] = useState<string | null>(null);

  const t = today();

  const tmStats = useMemo(() => {
    const rows = tm.data ?? [];
    return {
      total: rows.length,
      inProgress: rows.filter(tmIsStarted).length,
      delayed: rows.filter(tmIsDelayed).length,
      upcoming: rows.filter((r) => tmIsUpcoming(r, t)).length,
      completed: rows.filter(tmIsCompleted).length,
    };
  }, [tm.data, t]);

  const smStats = useMemo(() => {
    const rows = sm.data ?? [];
    return {
      total: rows.length,
      inProgress: rows.filter(smIsInProgress).length,
      delayed: rows.filter((r) => smIsDelayed(r, t)).length,
      upcoming: rows.filter((r) => smIsUpcoming(r, t)).length,
      completed: rows.filter(smIsCompleted).length,
    };
  }, [sm.data, t]);

  const abdStats = useMemo(() => {
    const rows = abd.data ?? [];
    return {
      total: rows.length,
      inProgress: rows.filter(abdIsInProgress).length,
      delayed: rows.filter((r) => abdIsDelayed(r, t)).length,
      upcoming: rows.filter((r) => abdIsUpcoming(r, t)).length,
      completed: rows.filter(abdIsApproved).length,
    };
  }, [abd.data, t]);

  const setTabFromKpi = (setter: (v: RowListTab) => void, kind: "risk" | "upcoming") => () => setter(kind);

  if (meLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isAdmin && !pic) {
    return (
      <div className="p-6">
        <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
          프로필에 HDEC PIC 값이 설정되어 있지 않습니다. 관리자에게 문의해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">My Work Space</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAdmin ? "관리자 모드 · 전체 담당자 데이터" : `HDEC PIC · ${pic}`} · Data as of {dohaStamp()}
          </p>
        </div>
        {isAdmin && (
          <Badge variant="secondary" className="uppercase tracking-wide">Admin View</Badge>
        )}
      </header>

      {/* ============= TM ============= */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Task Management</h2>
          <span className="text-xs text-muted-foreground">/ 담당 태스크 현황</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <ModuleKpiCard label="Total" value={tmStats.total} total={tmStats.total} tone="muted" onClick={() => { setTmTab("all"); }} />
          <ModuleKpiCard label="진행중" value={tmStats.inProgress} total={tmStats.total} tone="info" onClick={() => { setTmTab("all"); }} />
          <ModuleKpiCard label="지연" value={tmStats.delayed} total={tmStats.total} tone="destructive" active={tmTab === "risk"} onClick={setTabFromKpi(setTmTab, "risk")} />
          <ModuleKpiCard label="임박 (3d)" value={tmStats.upcoming} total={tmStats.total} tone="warning" animatePulse active={tmTab === "upcoming"} onClick={setTabFromKpi(setTmTab, "upcoming")} />
          <ModuleKpiCard label="완료" value={tmStats.completed} total={tmStats.total} tone="success" onClick={() => { setTmTab("all"); }} />
        </div>
        <ModuleRowList<TmMyRow>
          rows={tm.data ?? []}
          activeTab={tmTab}
          onTabChange={setTmTab}
          counts={{ all: tmStats.total, risk: tmStats.delayed, upcoming: tmStats.upcoming }}
          filterRow={(r, tab) => tab === "all" ? true : tab === "risk" ? tmIsDelayed(r) : tmIsUpcoming(r, t)}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate({ to: "/closure/task-management/detail/$id", params: { id: r.id } })}
          columns={[
            { key: "task_no", label: "Task No", width: "120px", render: (r) => <span className="font-mono text-[11px]">{r.task_no ?? "-"}</span> },
            { key: "level", label: "Tier", width: "60px", render: (r) => <span className="text-[10px] uppercase text-muted-foreground">{r.level ?? "-"}</span> },
            { key: "name", label: "Task", render: (r) => <span className="truncate block max-w-[420px]">{r.task_name ?? "-"}</span> },
            ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: TmMyRow) => r.hdec_pic_name ?? "-" }] : []),
            { key: "plan_end", label: "P.Finish", width: "100px", render: (r) => <span className="font-mono">{fmtDate(r.plan_end)}</span> },
            { key: "actual", label: "Actual%", width: "80px", className: "text-right", render: (r) => <span className="tabular-nums">{Math.round(Number(r.actual_progress ?? 0) * 100)}%</span> },
            { key: "j", label: "Alarm", width: "70px", render: (r) => <Badge variant="outline" className={cn("text-[10px]", r.auto_judgment === "위험" || r.auto_judgment === "지연" ? "border-destructive text-destructive" : r.auto_judgment === "주의" ? "border-warning text-warning" : r.auto_judgment === "완료" ? "border-success text-success" : "")}>{r.auto_judgment ?? "-"}</Badge> },
          ]}
        />
      </section>

      {/* ============= SM ============= */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Snag List</h2>
          <span className="text-xs text-muted-foreground">/ 담당 스낵 현황</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <ModuleKpiCard label="Total" value={smStats.total} total={smStats.total} tone="muted" onClick={() => setSmTab("all")} />
          <ModuleKpiCard label="진행중" value={smStats.inProgress} total={smStats.total} tone="info" onClick={() => setSmTab("all")} />
          <ModuleKpiCard label="지연" value={smStats.delayed} total={smStats.total} tone="destructive" active={smTab === "risk"} onClick={setTabFromKpi(setSmTab, "risk")} />
          <ModuleKpiCard label="임박 (3d)" value={smStats.upcoming} total={smStats.total} tone="warning" animatePulse active={smTab === "upcoming"} onClick={setTabFromKpi(setSmTab, "upcoming")} />
          <ModuleKpiCard label="완료" value={smStats.completed} total={smStats.total} tone="success" onClick={() => setSmTab("all")} />
        </div>
        <ModuleRowList<SmMyRow>
          rows={sm.data ?? []}
          activeTab={smTab}
          onTabChange={setSmTab}
          counts={{ all: smStats.total, risk: smStats.delayed, upcoming: smStats.upcoming }}
          filterRow={(r, tab) => tab === "all" ? true : tab === "risk" ? smIsDelayed(r, t) : smIsUpcoming(r, t)}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate({ to: "/closure/snag-management/detail/$id", params: { id: r.id } })}
          columns={[
            { key: "no", label: "ID", width: "100px", render: (r) => <span className="font-mono text-[11px]">{r.source_issue_no ?? "-"}</span> },
            { key: "loc", label: "Location", render: (r) => <span className="truncate block max-w-[300px]">{r.location_raw ?? "-"}</span> },
            { key: "trade", label: "Trade", width: "120px", render: (r) => r.main_trade ?? "-" },
            ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: SmMyRow) => r.hdec_pic_name ?? "-" }] : []),
            { key: "status", label: "Status", width: "110px", render: (r) => <Badge variant="outline" className="text-[10px]">{r.status_raw ?? "-"}</Badge> },
            { key: "due", label: "P.Closure", width: "100px", render: (r) => <span className="font-mono">{fmtDate(r.planned_closure_date ?? r.planned_rectified_date)}</span> },
          ]}
        />
      </section>

      {/* ============= ABD ============= */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">As Built Drawing</h2>
          <span className="text-xs text-muted-foreground">/ 담당 도서 현황</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <ModuleKpiCard label="Total" value={abdStats.total} total={abdStats.total} tone="muted" onClick={() => setAbdTab("all")} />
          <ModuleKpiCard label="진행중" value={abdStats.inProgress} total={abdStats.total} tone="info" onClick={() => setAbdTab("all")} />
          <ModuleKpiCard label="지연" value={abdStats.delayed} total={abdStats.total} tone="destructive" active={abdTab === "risk"} onClick={setTabFromKpi(setAbdTab, "risk")} />
          <ModuleKpiCard label="임박 (3d)" value={abdStats.upcoming} total={abdStats.total} tone="warning" animatePulse active={abdTab === "upcoming"} onClick={setTabFromKpi(setAbdTab, "upcoming")} />
          <ModuleKpiCard label="Approved" value={abdStats.completed} total={abdStats.total} tone="success" onClick={() => setAbdTab("all")} />
        </div>
        <ModuleRowList<AbdMyRow>
          rows={abd.data ?? []}
          activeTab={abdTab}
          onTabChange={setAbdTab}
          counts={{ all: abdStats.total, risk: abdStats.delayed, upcoming: abdStats.upcoming }}
          filterRow={(r, tab) => tab === "all" ? true : tab === "risk" ? abdIsDelayed(r, t) : abdIsUpcoming(r, t)}
          rowKey={(r) => r.id}
          onRowClick={(r) => setAbdDetailId(r.id)}
          columns={[
            { key: "no", label: "ABD No", width: "140px", render: (r) => <span className="font-mono text-[11px]">{r.abd_number ?? "-"}</span> },
            { key: "title", label: "Document", render: (r) => <span className="truncate block max-w-[360px]">{r.document_title ?? "-"}</span> },
            ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: AbdMyRow) => r.hdec_pic_name ?? "-" }] : []),
            { key: "stage", label: "Stage", width: "90px", render: (r) => <Badge variant="outline" className={cn("text-[10px]", abdIsApproved(r) && "border-success text-success")}>{abdStage(r)}</Badge> },
            { key: "rev", label: "Rev", width: "60px", render: (r) => r.latest_rev ?? "-" },
            { key: "plan", label: "P.Date", width: "100px", render: (r) => <span className="font-mono">{fmtDate(abdCurrentPlanDate(r))}</span> },
          ]}
        />
      </section>

      <AbdDetailSheet id={abdDetailId} onOpenChange={(open) => { if (!open) setAbdDetailId(null); }} />
    </div>
  );
}

// silence unused import warning if a lucide icon becomes unused after tweaks
void ShieldAlert;