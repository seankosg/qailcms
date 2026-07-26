import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useMyTasks, useMyDefectsCounts, useMyDefectsBucket, useMyAbd,
  tmIsCompleted, tmIsStarted, tmIsDelayed, tmJudgment, tmIsUpcoming, tmIsToday, tmTodayKinds,
  smTodayKinds,
  abdIsApproved, abdIsInProgress, abdIsDelayed, abdIsUpcoming, abdIsToday, abdTodayKind, abdStage, abdCurrentPlanDate,
  abdNeedsPlanning, abdNextPlanRoundLabel,
  today,
  type TmMyRow, type SmMyRow, type AbdMyRow,
} from "@/hooks/useMyWorkspaceData";
import { ModuleKpiCard, type KpiTone } from "./ModuleKpiCard";
import { ModuleRowList, type RowColumn, type RowListTab } from "./ModuleRowList";
import { MwsColumnOrderMenu } from "./MwsColumnOrderMenu";
import { useMwsColumnPrefs } from "@/hooks/useMwsColumnPrefs";
import { AbdDetailSheet } from "@/components/abd/raw-data/AbdDetailSheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dohaStamp, formatDdMmmYyyy } from "@/lib/time/doha";
import { cumPlanProgress, cumActualProgress, computeVariance } from "@/lib/task-management/derived";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { ClipboardList, AlertTriangle, FileCheck2 } from "lucide-react";
import { CommentsInbox } from "./CommentsInbox";
import { AttentionInbox } from "./AttentionInbox";

function fmtDate(d?: string | null): string {
  if (!d) return "-";
  return formatDdMmmYyyy(d) || "-";
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
void judgmentTone;

function daysBetweenIso(a?: string | null, base?: string | null): number | null {
  if (!a || !base) return null;
  const x = new Date(`${String(a).slice(0, 10)}T00:00:00Z`).getTime();
  const y = new Date(`${String(base).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round((x - y) / 86_400_000);
}

function CtxBadge({ text, tone = "muted" }: { text: string; tone?: "info" | "warning" | "destructive" | "success" | "muted" }) {
  const cls =
    tone === "info" ? "border-info text-info"
    : tone === "warning" ? "border-warning text-warning"
    : tone === "destructive" ? "border-destructive text-destructive"
    : tone === "success" ? "border-success text-success"
    : "";
  return <Badge variant="outline" className={cn("text-[10px] font-medium", cls)}>{text}</Badge>;
}

export interface MyWorkSpacePageProps {
  scope?: "pic" | "team";
}

export function MyWorkSpacePage({ scope = "pic" }: MyWorkSpacePageProps = {}) {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const navigate = useNavigate();

  const isAdmin = !!me?.isAdmin;
  const pic = me?.hdec_pic_name ?? null;
  const team = (me as any)?.team ?? null;
  const filterValue = scope === "team" ? team : pic;

  const tm = useMyTasks(filterValue, isAdmin, scope);
  const abd = useMyAbd(filterValue, isAdmin, scope);

  const [tmTab, setTmTab] = useState<RowListTab>("today");
  const [smTab, setSmTab] = useState<RowListTab>("today");
  const [abdTab, setAbdTab] = useState<RowListTab>("today");
  const [abdDetailId, setAbdDetailId] = useState<string | null>(null);

  const latestToday = today();
  const [dataDate, setDataDate] = useState<string>("");
  const t = dataDate || latestToday;

  // ─── SM: 서버 판정 카운트 + 버킷 fetch ───
  const smCountsQ = useMyDefectsCounts(filterValue, isAdmin, scope, t);
  const smBucket: "today" | "delayed" | "upcoming" | null =
    smTab === "today" ? "today"
    : smTab === "risk" ? "delayed"
    : smTab === "upcoming" ? "upcoming"
    : null;
  const smBucketQ = useMyDefectsBucket(filterValue, isAdmin, scope, t, smBucket);
  const smCounts = smCountsQ.data;
  const smStats = {
    total: smCounts?.total_count ?? 0,
    inProgress: smCounts?.in_progress_count ?? 0,
    delayed: smCounts?.delayed_count ?? 0,
    upcoming: smCounts?.upcoming_count ?? 0,
    completed: smCounts?.completed_count ?? 0,
    today: smCounts?.today_count ?? 0,
  };
  const smRows: SmMyRow[] = smBucketQ.data ?? [];

  // "전체" 탭 클릭 → SM Raw Data로 이동 (PIC/Team 필터 자동 적용)
  const gotoSnagRawData = () => {
    const search: Record<string, string> = {};
    if (!isAdmin) {
      if (scope === "team" && team) search.team = String(team);
      else if (scope === "pic" && pic) search.hdecPic = String(pic);
    }
    navigate({ to: "/closure/snag-management/raw-data", search: search as any });
  };

  const tmStats = useMemo(() => {
    const rows = tm.data ?? [];
    return {
      total: rows.length,
      inProgress: rows.filter(tmIsStarted).length,
      delayed: rows.filter(tmIsDelayed).length,
      upcoming: rows.filter((r) => tmIsUpcoming(r, t)).length,
      completed: rows.filter(tmIsCompleted).length,
      today: rows.filter((r) => tmIsToday(r, t)).length,
    };
  }, [tm.data, t]);

  const abdStats = useMemo(() => {
    const rows = abd.data ?? [];
    return {
      total: rows.length,
      inProgress: rows.filter(abdIsInProgress).length,
      delayed: rows.filter((r) => abdIsDelayed(r, t)).length,
      upcoming: rows.filter((r) => abdIsUpcoming(r, t)).length,
      completed: rows.filter(abdIsApproved).length,
      today: rows.filter((r) => abdIsToday(r, t)).length,
    };
  }, [abd.data, t]);

  const setTabFromKpi = (setter: (v: RowListTab) => void, kind: "risk" | "upcoming") => () => setter(kind);

  // ---------- Context 컬럼 렌더 (탭별) ----------
  const renderTmCtx = (r: TmMyRow, tab: RowListTab): React.ReactNode => {
    if (tab === "today") {
      const kinds = tmTodayKinds(r, t);
      if (kinds.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex gap-1">
          {kinds.map((k) => (
            <CtxBadge key={k} text={k} tone={k === "Start" ? "info" : "warning"} />
          ))}
        </div>
      );
    }
    if (tab === "risk") {
      const v = computeVariance(r as any, t);
      const gap = v ?? (cumActualProgress(r as any) - cumPlanProgress(r as any, t));
      const pct = Math.round(gap * 100);
      return <span className="tabular-nums font-medium text-destructive">{pct}%</span>;
    }
    if (tab === "upcoming") {
      const d = daysBetweenIso(r.plan_end, t);
      return d != null ? <span className="tabular-nums font-medium text-warning">D-{d}</span> : <span className="text-muted-foreground">—</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  };
  const renderSmCtx = (r: SmMyRow, tab: RowListTab): React.ReactNode => {
    if (tab === "today") {
      const kinds = smTodayKinds(r, t);
      if (kinds.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex gap-1 flex-wrap">
          {kinds.map((k) => (
            <CtxBadge key={k} text={k} tone={k === "Start" ? "info" : k === "Close" ? "success" : "warning"} />
          ))}
        </div>
      );
    }
    if (tab === "risk") {
      const due = r.planned_closure_date ?? r.planned_rectified_date;
      const d = daysBetweenIso(t, due);
      return d != null && d > 0 ? <span className="tabular-nums font-medium text-destructive">D+{d}</span> : <span className="text-muted-foreground">—</span>;
    }
    if (tab === "upcoming") {
      const due = r.planned_closure_date ?? r.planned_rectified_date;
      const d = daysBetweenIso(due, t);
      return d != null && d > 0 ? <span className="tabular-nums font-medium text-warning">D-{d}</span> : <span className="text-muted-foreground">—</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  };
  const renderAbdCtx = (r: AbdMyRow, tab: RowListTab): React.ReactNode => {
    const npBadge = abdNeedsPlanning(r) ? (
      <CtxBadge text={`계획필요 ${abdNextPlanRoundLabel(r) ?? ""}`.trim()} tone="destructive" />
    ) : null;
    if (tab === "today") {
      const k = abdTodayKind(r, t);
      return (
        <div className="flex gap-1 flex-wrap">
          {k ? <CtxBadge text={k} tone={k === "Draft" ? "info" : k === "Sub" ? "warning" : "success"} /> : null}
          {npBadge}
          {!k && !npBadge ? <span className="text-muted-foreground">—</span> : null}
        </div>
      );
    }
    const plan = abdCurrentPlanDate(r);
    if (tab === "risk") {
      const d = daysBetweenIso(t, plan);
      return (
        <div className="flex items-center gap-1">
          {d != null && d > 0 ? <span className="tabular-nums font-medium text-destructive">D+{d}</span> : <span className="text-muted-foreground">—</span>}
          {npBadge}
        </div>
      );
    }
    if (tab === "upcoming") {
      const d = daysBetweenIso(plan, t);
      return (
        <div className="flex items-center gap-1">
          {d != null && d > 0 ? <span className="tabular-nums font-medium text-warning">D-{d}</span> : <span className="text-muted-foreground">—</span>}
          {npBadge}
        </div>
      );
    }
    return npBadge ?? <span className="text-muted-foreground">—</span>;
  };

  // ---------- 컬럼 정의 ----------
  const tmColumns: RowColumn<TmMyRow>[] = [
    { key: "__ctx", label: "구분", width: "88px", render: (r) => renderTmCtx(r, tmTab) },
    { key: "task_no", label: "Task No", width: "120px", render: (r) => <span className="font-mono text-[11px]">{r.task_no ?? "-"}</span> },
    { key: "level", label: "Tier", width: "60px", render: (r) => <span className="text-[10px] uppercase text-muted-foreground">{r.level ?? "-"}</span> },
    { key: "name", label: "Task", render: (r) => <span className="truncate block max-w-[420px]">{r.task_name ?? "-"}</span> },
    ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: TmMyRow) => r.hdec_pic_name ?? "-" }] : []),
    { key: "plan_end", label: "P.Finish", width: "100px", render: (r) => <span className="font-mono">{fmtDate(r.plan_end)}</span> },
    { key: "plan_pct", label: "Plan%", width: "70px", className: "text-right", render: (r) => <span className="tabular-nums text-muted-foreground">{Math.round(cumPlanProgress(r as any) * 100)}%</span> },
    { key: "actual", label: "Actual%", width: "70px", className: "text-right", render: (r) => <span className="tabular-nums">{Math.round(Number(r.actual_progress ?? 0) * 100)}%</span> },
    { key: "diff", label: "Diff%", width: "70px", className: "text-right", render: (r) => {
      const v = computeVariance(r as any);
      if (v == null) return <span className="tabular-nums text-muted-foreground">-</span>;
      const pct = Math.round(v * 100);
      return <span className={cn("tabular-nums font-medium", pct < 0 ? "text-destructive" : pct > 0 ? "text-success" : "text-muted-foreground")}>{pct > 0 ? "+" : ""}{pct}%</span>;
    } },
    { key: "j", label: "Alarm", width: "70px", render: (r) => <Badge variant="outline" className={cn("text-[10px]", r.auto_judgment === "위험" || r.auto_judgment === "지연" ? "border-destructive text-destructive" : r.auto_judgment === "주의" ? "border-warning text-warning" : r.auto_judgment === "완료" ? "border-success text-success" : "")}>{r.auto_judgment ?? "-"}</Badge> },
  ];
  const smColumns: RowColumn<SmMyRow>[] = [
    { key: "__ctx", label: "구분", width: "108px", render: (r) => renderSmCtx(r, smTab) },
    { key: "no", label: "ID", width: "100px", render: (r) => <span className="font-mono text-[11px]">{r.source_issue_no ?? "-"}</span> },
    { key: "loc", label: "Location", render: (r) => <span className="truncate block max-w-[300px]">{r.location_raw ?? "-"}</span> },
    { key: "trade", label: "Trade", width: "120px", render: (r) => r.main_trade ?? "-" },
    ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: SmMyRow) => r.hdec_pic_name ?? "-" }] : []),
    { key: "status", label: "Status", width: "110px", render: (r) => <Badge variant="outline" className="text-[10px]">{r.status_raw ?? "-"}</Badge> },
    { key: "due", label: "P.Closure", width: "100px", render: (r) => <span className="font-mono">{fmtDate(r.planned_closure_date ?? r.planned_rectified_date)}</span> },
  ];
  const abdColumns: RowColumn<AbdMyRow>[] = [
    { key: "__ctx", label: "구분", width: "88px", render: (r) => renderAbdCtx(r, abdTab) },
    { key: "no", label: "ABD No", width: "140px", render: (r) => <span className="font-mono text-[11px]">{r.abd_number ?? "-"}</span> },
    { key: "title", label: "Document", render: (r) => <span className="truncate block max-w-[360px]">{r.document_title ?? "-"}</span> },
    ...(isAdmin ? [{ key: "pic", label: "HDEC PIC", width: "120px", render: (r: AbdMyRow) => r.hdec_pic_name ?? "-" }] : []),
    { key: "stage", label: "Stage", width: "90px", render: (r) => <Badge variant="outline" className={cn("text-[10px]", abdIsApproved(r) && "border-success text-success")}>{abdStage(r)}</Badge> },
    { key: "rev", label: "Rev", width: "60px", render: (r) => r.latest_rev ?? "-" },
    { key: "plan", label: "P.Date", width: "100px", render: (r) => <span className="font-mono">{fmtDate(abdCurrentPlanDate(r))}</span> },
  ];

  // ---------- Columns 메뉴 상태 ----------
  const tmDefaults = useMemo(() => ({
    order: tmColumns.map((c) => c.key),
    visibility: Object.fromEntries(tmColumns.map((c) => [c.key, true])),
    frozen: ["__ctx"],
  }), [tmColumns]);
  const smDefaults = useMemo(() => ({
    order: smColumns.map((c) => c.key),
    visibility: Object.fromEntries(smColumns.map((c) => [c.key, true])),
    frozen: ["__ctx"],
  }), [smColumns]);
  const abdDefaults = useMemo(() => ({
    order: abdColumns.map((c) => c.key),
    visibility: Object.fromEntries(abdColumns.map((c) => [c.key, true])),
    frozen: ["__ctx"],
  }), [abdColumns]);

  const prefsSuffix = scope === "team" ? "-team" : "";
  const tmPrefs = useMwsColumnPrefs(`mws-tm${prefsSuffix}`, tmDefaults);
  const smPrefs = useMwsColumnPrefs(`mws-sm${prefsSuffix}`, smDefaults);
  const abdPrefs = useMwsColumnPrefs(`mws-abd${prefsSuffix}`, abdDefaults);

  const labelDict = <T,>(cols: RowColumn<T>[]) => Object.fromEntries(cols.map((c) => [c.key, c.label]));

  if (meLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isAdmin && !filterValue) {
    return (
      <div className="p-6">
        <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
          {scope === "team"
            ? "프로필에 소속 팀 정보가 설정되어 있지 않습니다. 관리자에게 문의해주세요."
            : "프로필에 HDEC PIC 값이 설정되어 있지 않습니다. 관리자에게 문의해주세요."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">
            {scope === "team" ? "My Team Work Space" : "My Work Space"}
            {scope === "team" && !isAdmin && team ? ` — ${team}` : ""}
            {scope === "team" && isAdmin ? " — 전체" : ""}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAdmin
              ? "관리자 모드 · 전체 데이터"
              : scope === "team"
                ? `Team · ${team}`
                : `HDEC PIC · ${pic}`}
            {" · Data as of "}{dohaStamp()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataDatePicker
            value={dataDate}
            latest={latestToday}
            options={[]}
            onChange={setDataDate}
            onReset={() => setDataDate("")}
          />
          {isAdmin && (
            <Badge variant="secondary" className="uppercase tracking-wide">Admin View</Badge>
          )}
        </div>
      </header>

      <CommentsInbox
        userId={me?.id ?? null}
        scope={scope}
        filterValue={filterValue}
        isAdmin={isAdmin}
      />

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
          counts={{ today: tmStats.today, all: tmStats.total, risk: tmStats.delayed, upcoming: tmStats.upcoming }}
          filterRow={(r, tab) =>
            tab === "all" ? true
            : tab === "risk" ? tmIsDelayed(r)
            : tab === "today" ? tmIsToday(r, t)
            : tmIsUpcoming(r, t)
          }
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate({ to: "/closure/task-management/detail/$id", params: { id: r.id } })}
          columns={tmColumns}
          order={tmPrefs.order}
          visibility={tmPrefs.visibility}
          frozen={tmPrefs.frozen}
          toolbarExtra={
            <MwsColumnOrderMenu
              order={tmPrefs.order}
              visibility={tmPrefs.visibility}
              frozen={tmPrefs.frozen}
              forcedFrozen={["__ctx"]}
              labels={labelDict(tmColumns)}
              defaultOrder={tmDefaults.order}
              defaultVisibility={tmDefaults.visibility}
              defaultFrozen={tmDefaults.frozen}
              onOrderChange={tmPrefs.setOrder}
              onVisibilityChange={tmPrefs.setVisibility}
              onFrozenChange={tmPrefs.setFrozen}
            />
          }
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
          <ModuleKpiCard label="Total" value={smStats.total} total={smStats.total} tone="muted" onClick={gotoSnagRawData} />
          <ModuleKpiCard label="진행중" value={smStats.inProgress} total={smStats.total} tone="info" onClick={gotoSnagRawData} />
          <ModuleKpiCard label="지연" value={smStats.delayed} total={smStats.total} tone="destructive" active={smTab === "risk"} onClick={setTabFromKpi(setSmTab, "risk")} />
          <ModuleKpiCard label="임박 (3d)" value={smStats.upcoming} total={smStats.total} tone="warning" animatePulse active={smTab === "upcoming"} onClick={setTabFromKpi(setSmTab, "upcoming")} />
          <ModuleKpiCard label="완료" value={smStats.completed} total={smStats.total} tone="success" onClick={gotoSnagRawData} />
        </div>
        <ModuleRowList<SmMyRow>
          rows={smRows}
          activeTab={smTab}
          onTabChange={(tab) => {
            if (tab === "all") { gotoSnagRawData(); return; }
            setSmTab(tab);
          }}
          counts={{ today: smStats.today, all: smStats.total, risk: smStats.delayed, upcoming: smStats.upcoming }}
          filterRow={() => true}
          emptyText={smBucketQ.isLoading ? "불러오는 중…" : "표시할 항목이 없습니다."}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate({ to: "/closure/snag-management/detail/$id", params: { id: r.id } })}
          columns={smColumns}
          order={smPrefs.order}
          visibility={smPrefs.visibility}
          frozen={smPrefs.frozen}
          toolbarExtra={
            <MwsColumnOrderMenu
              order={smPrefs.order}
              visibility={smPrefs.visibility}
              frozen={smPrefs.frozen}
              forcedFrozen={["__ctx"]}
              labels={labelDict(smColumns)}
              defaultOrder={smDefaults.order}
              defaultVisibility={smDefaults.visibility}
              defaultFrozen={smDefaults.frozen}
              onOrderChange={smPrefs.setOrder}
              onVisibilityChange={smPrefs.setVisibility}
              onFrozenChange={smPrefs.setFrozen}
            />
          }
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
          counts={{ today: abdStats.today, all: abdStats.total, risk: abdStats.delayed, upcoming: abdStats.upcoming }}
          filterRow={(r, tab) =>
            tab === "all" ? true
            : tab === "risk" ? abdIsDelayed(r, t)
            : tab === "today" ? abdIsToday(r, t)
            : abdIsUpcoming(r, t)
          }
          rowKey={(r) => r.id}
          onRowClick={(r) => setAbdDetailId(r.id)}
          columns={abdColumns}
          order={abdPrefs.order}
          visibility={abdPrefs.visibility}
          frozen={abdPrefs.frozen}
          toolbarExtra={
            <MwsColumnOrderMenu
              order={abdPrefs.order}
              visibility={abdPrefs.visibility}
              frozen={abdPrefs.frozen}
              forcedFrozen={["__ctx"]}
              labels={labelDict(abdColumns)}
              defaultOrder={abdDefaults.order}
              defaultVisibility={abdDefaults.visibility}
              defaultFrozen={abdDefaults.frozen}
              onOrderChange={abdPrefs.setOrder}
              onVisibilityChange={abdPrefs.setVisibility}
              onFrozenChange={abdPrefs.setFrozen}
            />
          }
        />
      </section>

      <AttentionInbox
        userId={me?.id ?? null}
        scope={scope}
        filterValue={filterValue}
        isAdmin={isAdmin}
      />

      <AbdDetailSheet id={abdDetailId} onOpenChange={(open) => { if (!open) setAbdDetailId(null); }} />
    </div>
  );
}
