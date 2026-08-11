import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LogOut, ChevronDown, ChevronRight, ShieldCheck, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { TopBrandHeader } from "@/components/layout/TopBrandHeader";
import { UpdateAvailableBanner } from "@/components/layout/UpdateAvailableBanner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// 3D nav icons
import iconUser from "@/assets/nav-icons/user-3d.png";
import iconDashboard from "@/assets/nav-icons/dashboard-3d.png";
import iconClipboard from "@/assets/nav-icons/clipboard-3d.png";
import iconWarning from "@/assets/nav-icons/warning-3d.png";
import iconBlueprint from "@/assets/nav-icons/blueprint-3d.png";
import iconBox from "@/assets/nav-icons/box-3d.png";
import iconCertificate from "@/assets/nav-icons/certificate-3d.png";
import iconHelmet from "@/assets/nav-icons/helmet-3d.png";
import iconUpload from "@/assets/nav-icons/upload-3d.png";
import iconHistory from "@/assets/nav-icons/history-3d.png";
import iconPeople from "@/assets/nav-icons/people-3d.png";
import iconDatabase from "@/assets/nav-icons/database-3d.png";
import iconLink from "@/assets/nav-icons/link-3d.png";
import iconSlider from "@/assets/nav-icons/slider-3d.png";
import iconTree from "@/assets/nav-icons/tree-3d.png";
import iconChartUp from "@/assets/nav-icons/chart-up-3d.png";
import iconCalendar from "@/assets/nav-icons/calendar-3d.png";
import iconRefresh from "@/assets/nav-icons/refresh-3d.png";
import iconGear from "@/assets/nav-icons/settings-gear-3d.png";

type NavLeaf = {
  to?: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  editorOnly?: boolean;
  disabled?: boolean;
  badge?: string;
  /** admin 역할 단독 노출(superuser 제외). §1(2026-08-04) */
  strictAdminOnly?: boolean;
  abdOcsOnly?: boolean;
};
type NavModule = {
  label: string;
  icon: string;
  matchPrefix: string;
  items: NavLeaf[];
  adminOnly?: boolean;
};
type NavSection = {
  label: string;
  dashboard?: NavLeaf;
  modules?: NavModule[];
  items?: NavLeaf[];
};

const NAV: NavSection[] = [
  {
    label: "Work Space",
    dashboard: { to: "/my-work-space", label: "My Work Space", icon: iconUser },
    items: [
      { to: "/my-kpi-analysis", label: "My KPI Analysis", icon: iconChartUp },
      { to: "/my-team-work-space", label: "My Team Work Space", icon: iconPeople },
    ],
  },
  {
    label: "Project Wide",
    dashboard: { to: "/project-dashboard", label: "Milestone Timeline", icon: iconDashboard },
  },
  {
    label: "Outstanding Work",
    modules: [
      {
        label: "Task Management",
        icon: iconClipboard,
        matchPrefix: "/closure/task-management",
        items: [
          { to: "/closure/task-management/dashboard", label: "Dashboard", icon: iconDashboard },
          { to: "/closure/task-management/kpi-analysis", label: "KPI Analysis", icon: iconChartUp },
          { to: "/closure/task-management/tree", label: "Task Summary", icon: iconTree },
          { to: "/closure/task-management/raw-data", label: "Raw Data", icon: iconDatabase },
          { to: "/closure/task-management/schedule-revision", label: "Schedule Revision", icon: iconCalendar },
        ],
      },
      {
        label: "Snag List Management",
        icon: iconWarning,
        matchPrefix: "/closure/snag-management",
        items: [
          { to: "/closure/snag-management/dashboard", label: "Dashboard", icon: iconDashboard },
          { to: "/closure/snag-management/progress", label: "Progress", icon: iconChartUp },
          { to: "/closure/snag-management/kpi-analysis", label: "KPI Analysis", icon: iconChartUp },
          { to: "/closure/snag-management/raw-data", label: "Raw Data", icon: iconDatabase },
          { to: "/closure/snag-management/settings", label: "Settings", icon: iconGear, adminOnly: true },
        ],
      },
    ],
  },
  {
    label: "Close-Out Doc",
    dashboard: { to: "/closeout/dashboard", label: "Dashboard", icon: iconDashboard },
    modules: [
      {
        label: "As Built Drawing",
        icon: iconBlueprint,
        matchPrefix: "/closure/abd",
        items: [
          { to: "/closure/abd/dashboard", label: "Dashboard", icon: iconDashboard },
          { to: "/closure/abd/progress", label: "Progress", icon: iconChartUp },
          { to: "/closure/abd/raw-data", label: "Raw Data", icon: iconDatabase },
        ],
      },
      {
        label: "Warranty & License",
        icon: iconCertificate,
        matchPrefix: "/closure/warranty",
        adminOnly: true,
        items: [
          { to: "/closure/warranty/raw-data", label: "Raw Data", icon: iconDatabase },
        ],
      },
      {
        label: "Spare Part List",
        icon: iconDatabase,
        matchPrefix: "/closure/spare-part",
        items: [
          { to: "/closure/spare-part/raw-data", label: "Raw Data", icon: iconDatabase },
        ],
      },
    ],
  },
  {
    label: "Resource",
    dashboard: { to: "/resource/dashboard", label: "Dashboard", icon: iconDashboard },
    modules: [
      {
        label: "DMR (Daily Manpower Record)",
        icon: iconHelmet,
        matchPrefix: "/resource/dmr",
        items: [
          { to: "/resource/dmr/dashboard", label: "Dashboard", icon: iconDashboard },
          { to: "/resource/dmr/raw-data", label: "Raw Data", icon: iconDatabase },
        ],
      },
    ],
  },
  {
    label: "Import & Log",
    items: [
      { to: "/import-log/import", label: "Import", icon: iconUpload, editorOnly: true },
      { to: "/import-log/logs", label: "Import Logs", icon: iconHistory, editorOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/admin", label: "Overview", icon: iconDashboard, adminOnly: true },
      { to: "/admin/users", label: "사용자", icon: iconPeople, adminOnly: true },
      { to: "/admin/permissions", label: "권한", icon: iconSlider, adminOnly: true, strictAdminOnly: true },
      { to: "/admin/masters", label: "마스터", icon: iconDatabase, adminOnly: true },
      { to: "/admin/mapping", label: "Mapping", icon: iconLink, adminOnly: true },
      { to: "/admin/task-thresholds", label: "Task 임계값", icon: iconSlider, adminOnly: true },
      { to: "/admin/milestones", label: "Milestone", icon: iconCalendar, adminOnly: true },
      { to: "/admin/ocs-import", label: "OCS Maintenance", icon: iconLink, abdOcsOnly: true },
      { to: "/admin/backup", label: "Backup", icon: iconDatabase, adminOnly: true },
    ],
  },
];

const MODULE_OPEN_STORAGE_KEY = "qail-cms:sidebar:module-open:v1";
const COLLAPSED_STORAGE_KEY = "qail-cms:sidebar:collapsed:v1";

function loadModuleOpen(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODULE_OPEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function NavIcon({ src, size = "md", active = false }: { src: string; size?: "sm" | "md" | "lg"; active?: boolean }) {
  const sizeCls = size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      width={512}
      height={512}
      className={cn(
        sizeCls,
        "shrink-0 select-none object-contain transition-transform duration-150",
        active && "scale-[1.06] drop-shadow-[0_2px_5px_color-mix(in_oklab,var(--primary)_45%,transparent)]",
      )}
    />
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: me } = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState<Record<string, boolean>>(() => loadModuleOpen());
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  // Keyboard shortcut: [ collapses, ] expands
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") setCollapsed(true);
      else if (e.key === "]") setCollapsed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const displayRoleLabel = me?.roleLabel
    ?? (me?.isDSuperUser ? "D.Superuser" : me?.isSuperUser ? "Superuser" : me?.isAdmin ? "Admin" : me?.isSeniorUser ? "Senior User" : me?.isUser ? "User" : me?.isSuperGuest ? "Super Guest" : "Guest");

  const isVisible = (it: NavLeaf) => {
    if (it.abdOcsOnly) return canAccessAbdOcs({ userType: me?.userType, team: me?.team, isStrictAdmin: me?.isStrictAdmin });
    if (it.adminOnly && !me?.isAdmin) return false;
    if (it.strictAdminOnly && !me?.isStrictAdmin) return false;
    if (it.editorOnly && !me?.isEditor) return false;
    return true;
  };

  const toggleModule = (key: string, defaultOpen: boolean) => {
    setModuleOpen((prev) => {
      const current = prev[key] ?? defaultOpen;
      const next = { ...prev, [key]: !current };
      try {
        window.localStorage.setItem(MODULE_OPEN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  type LeafLevel = "dashboard" | "sub";

  const renderLeaf = (it: NavLeaf, level: LeafLevel = "dashboard", forceExpanded = false) => {
    const isCollapsed = collapsed && !forceExpanded;
    const active = it.to ? location.pathname === it.to || location.pathname.startsWith(it.to + "/") : false;
    const isSub = level === "sub";
    if (it.disabled || !it.to) {
      if (isCollapsed) {
        return (
          <div
            key={it.label}
            className="flex items-center justify-center rounded-md py-2 text-muted-foreground/60"
            title={it.label}
          >
            <NavIcon src={it.icon} size="md" />
          </div>
        );
      }
      return (
        <div
          key={it.label}
          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-normal text-muted-foreground/60 cursor-not-allowed"
        >
          <NavIcon src={it.icon} size="sm" />
          <span className="flex-1">{it.label}</span>
          {it.badge && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{it.badge}</span>
          )}
        </div>
      );
    }
    if (isCollapsed) {
      const link = (
        <Link
          key={it.to}
          to={it.to}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "relative flex items-center justify-center rounded-lg py-2 transition-colors",
            active
              ? "bg-primary/12 shadow-[inset_2px_0_0_0_var(--primary)]"
              : "hover:bg-sidebar-accent/70",
          )}
          aria-label={it.label}
        >
          <NavIcon src={it.icon} size="md" active={active} />
        </Link>
      );
      return (
        <Tooltip key={it.to} delayDuration={150}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs font-medium">
            {it.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    const activeClasses =
      "border-l-[3px] border-primary bg-primary/10 pl-[calc(0.5rem-3px)] pr-2 font-semibold text-primary";
    const inactiveClasses = isSub
      ? "px-2 font-normal text-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground"
      : "px-2 font-medium text-foreground hover:bg-sidebar-accent/70 hover:text-primary";
    return (
      <Link
        key={it.to}
        to={it.to}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "group flex items-center gap-2.5 rounded-md py-1.5 text-[13px] transition-colors",
          active ? activeClasses : inactiveClasses,
        )}
      >
        <NavIcon src={it.icon} size="sm" active={active} />
        <span className="flex-1 truncate">{it.label}</span>
        {it.badge && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{it.badge}</span>
        )}
      </Link>
    );
  };

  const sidebarWidth = collapsed ? "w-16" : "w-64";
  const mainPad = collapsed ? "lg:pl-16" : "lg:pl-64";

  return (
    <TooltipProvider delayDuration={150}>
    <div className={cn("min-h-dvh bg-muted/30 transition-[padding] duration-200 motion-reduce:transition-none", mainPad)}>
      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] transition-[transform,width] duration-200 motion-reduce:transition-none lg:translate-x-0 lg:pb-0 lg:pl-0",
          sidebarWidth,
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {collapsed ? (
          <div className="flex h-14 flex-col items-center justify-center gap-1 border-b">
            <span className="text-[10px] font-bold tracking-wider text-primary">QAIL</span>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate({ to: "/change-password" })} title="비밀번호 변경">
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSignOut} title="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-14 items-center justify-end gap-2 border-b px-4">
            <span className="max-w-[110px] truncate text-sm font-medium">{me?.name ?? me?.email}</span>
            {me?.primaryRole === "guest" || me?.isGuest ? (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Guest</span>
            ) : me?.isAdmin || me?.isDSuperUser ? (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <ShieldCheck className="h-3 w-3" />
                {displayRoleLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                {displayRoleLabel}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate({ to: "/change-password" })} title="비밀번호 변경">
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSignOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-1.5 py-3" : "p-3")}>
          {NAV.map((section) => {
            // Admin section gate
            if (
              section.label === "Admin" &&
              !me?.isAdmin &&
              !canAccessAbdOcs({ userType: me?.userType, team: me?.team, isStrictAdmin: me?.isStrictAdmin })
            )
              return null;

            const modules = (section.modules ?? [])
              .filter((m) => !m.adminOnly || me?.isAdmin)
              .filter((m) => m.items.some(isVisible));
            const flatItems = (section.items ?? []).filter(isVisible);
            const sectionDashboard = section.dashboard;
            const hasContent = !!sectionDashboard || modules.length > 0 || flatItems.length > 0;
            if (!hasContent) return null;

            return (
              <div key={section.label} className={cn("first:mt-0", collapsed ? "mt-3" : "mt-5")}>
                {collapsed ? (
                  <div className="mx-2 mb-1.5 h-px bg-border/60" />
                ) : (
                  <div className="mb-1 mt-1 flex items-center gap-2 px-2">
                    <span className="h-3.5 w-1 rounded-full bg-primary/70" />
                    <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-foreground/70">
                      {section.label}
                    </span>
                  </div>
                )}
                <div className={cn("space-y-0.5", collapsed ? "mt-0" : "mt-1")}>
                  {sectionDashboard && renderLeaf(sectionDashboard, "dashboard")}
                  {flatItems.map((it) => renderLeaf(it, "dashboard"))}
                  {modules.map((mod) => {
                    const key = section.label + "::" + mod.label;
                    const autoOpen = location.pathname.startsWith(mod.matchPrefix);
                    const open = moduleOpen[key] ?? autoOpen;
                    const visibleItems = mod.items.filter(isVisible);
                    const anyActive = visibleItems.some(
                      (it) => it.to && (location.pathname === it.to || location.pathname.startsWith(it.to + "/")),
                    );

                    if (collapsed) {
                      return (
                        <HoverCard key={mod.label} openDelay={80} closeDelay={100}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "relative flex w-full items-center justify-center rounded-lg py-2 transition-colors",
                                anyActive
                                  ? "bg-primary/12 shadow-[inset_2px_0_0_0_var(--primary)]"
                                  : "hover:bg-sidebar-accent/70",
                              )}
                              aria-label={mod.label}
                            >
                              <NavIcon src={mod.icon} size="md" active={anyActive} />
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent side="right" align="start" className="w-56 p-2">
                            <div className="mb-1 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {mod.label}
                            </div>
                            <div className="space-y-0.5">
                              {visibleItems.map((it) => renderLeaf(it, "sub", true))}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      );
                    }

                    return (
                      <div key={mod.label} className="mt-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleModule(key, autoOpen)}
                          className={cn(
                            "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-primary",
                            anyActive && "text-primary",
                          )}
                        >
                          <NavIcon src={mod.icon} size="sm" active={anyActive} />
                          <span className="flex-1 text-left">{mod.label}</span>
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                          )}
                        </button>
                        {open && (
                          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
                            {visibleItems.map((it) => renderLeaf(it, "sub"))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-h-dvh min-w-0 flex-col">
        <TopBrandHeader
          onMobileMenu={() => setMobileOpen(true)}
          onToggleSidebar={() => setCollapsed((v) => !v)}
          sidebarCollapsed={collapsed}
        />
        <UpdateAvailableBanner />
        <main className="flex-1 min-w-0 overflow-x-clip p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))] lg:p-6">
          {children}
        </main>
      </div>
    </div>
    </TooltipProvider>
  );
}