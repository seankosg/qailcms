import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Database, Upload, FileClock, RefreshCw, LogOut, Menu, ChevronDown, ChevronRight, Package, Wrench, ShieldCheck, Settings2, Users, AlertTriangle, FileSpreadsheet, ClipboardList, FileCheck2, HardHat,
} from "lucide-react";
import { ListTree, Sliders, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { TopBrandHeader } from "@/components/layout/TopBrandHeader";
import { UpdateAvailableBanner } from "@/components/layout/UpdateAvailableBanner";

type NavLeaf = {
  to?: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  editorOnly?: boolean;
  disabled?: boolean;
  badge?: string;
};
type NavModule = {
  label: string;
  icon: typeof Package;
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
    label: "Outstanding Work",
    dashboard: { to: "/outstanding/dashboard", label: "Dashboard", icon: LayoutDashboard },
    modules: [
      {
        label: "Task Management",
        icon: ClipboardList,
        matchPrefix: "/closure/task-management",
        items: [
          { to: "/closure/task-management/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/closure/task-management/tree", label: "Task Summary", icon: ListTree },
          { to: "/closure/task-management/raw-data", label: "Raw Data", icon: Database },
        ],
      },
      {
        label: "Snag List Management",
        icon: AlertTriangle,
        matchPrefix: "/closure/snag-management",
        items: [
          { to: "/closure/snag-management/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/closure/snag-management/progress", label: "Progress", icon: TrendingUp },
          { to: "/closure/snag-management/raw-data", label: "Raw Data", icon: Database },
          { to: "/closure/snag-management/settings", label: "Settings", icon: Settings2, adminOnly: true },
        ],
      },
    ],
  },
  {
    label: "Close-Out Doc",
    dashboard: { to: "/closeout/dashboard", label: "Dashboard", icon: LayoutDashboard },
    modules: [
      {
        label: "As Built Drawing",
        icon: FileSpreadsheet,
        matchPrefix: "/closure/abd",
        items: [
          { to: "/closure/abd/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/closure/abd/progress", label: "Progress", icon: TrendingUp },
          { to: "/closure/abd/raw-data", label: "Raw Data", icon: Database },
        ],
      },
      {
        label: "Spare Part",
        icon: Package,
        matchPrefix: "/closure/spare-part",
        adminOnly: true,
        items: [
          { to: "/closure/spare-part/raw-data", label: "Raw Data", icon: Database },
          { to: "/closure/spare-part/aconex-sync", label: "Aconex Sync", icon: RefreshCw, editorOnly: true },
        ],
      },
      {
        label: "Warranty & License",
        icon: FileCheck2,
        matchPrefix: "/closure/warranty",
        adminOnly: true,
        items: [
          { label: "Coming soon", icon: FileCheck2, disabled: true, badge: "Soon" },
        ],
      },
    ],
  },
  {
    label: "Resource",
    dashboard: { to: "/resource/dashboard", label: "Dashboard", icon: LayoutDashboard },
    modules: [
      {
        label: "DMR (Daily Manpower)",
        icon: HardHat,
        matchPrefix: "/resource/dmr",
        items: [
          { to: "/resource/dmr/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/resource/dmr/raw-data", label: "Raw Data", icon: Database },
          { to: "/resource/dmr/import", label: "Import", icon: Upload, editorOnly: true },
        ],
      },
    ],
  },
  {
    label: "Import & Log",
    items: [
      { to: "/import-log/import", label: "Import", icon: Upload, editorOnly: true },
      { to: "/import-log/logs", label: "Import Logs", icon: FileClock, editorOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, adminOnly: true },
      { to: "/admin/users", label: "사용자", icon: Users, adminOnly: true },
      { to: "/admin/masters", label: "마스터", icon: Users, adminOnly: true },
      { to: "/admin/mapping", label: "Mapping", icon: Settings2, adminOnly: true },
      { to: "/admin/task-thresholds", label: "Task 임계값", icon: Sliders, adminOnly: true },
    ],
  },
];

const MODULE_OPEN_STORAGE_KEY = "qail-cms:sidebar:module-open:v1";

function loadModuleOpen(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODULE_OPEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: me } = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState<Record<string, boolean>>(() => loadModuleOpen());
  const displayRoleLabel = me?.roleLabel
    ?? (me?.isDSuperUser ? "D.Superuser" : me?.isSuperUser ? "Superuser" : me?.isAdmin ? "Admin" : me?.isSeniorUser ? "Senior User" : me?.isUser ? "User" : me?.isSuperGuest ? "Super Guest" : "Guest");

  const isVisible = (it: NavLeaf) => {
    if (it.adminOnly && !me?.isAdmin) return false;
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

  const renderLeaf = (it: NavLeaf, level: LeafLevel = "dashboard") => {
    const active = it.to ? location.pathname === it.to || location.pathname.startsWith(it.to + "/") : false;
    const isSub = level === "sub";
    if (it.disabled || !it.to) {
      return (
        <div
          key={it.label}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal text-muted-foreground/60 cursor-not-allowed"
        >
          <it.icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <span className="flex-1">{it.label}</span>
          {it.badge && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{it.badge}</span>
          )}
        </div>
      );
    }
    const activeClasses =
      "border-l-2 border-primary bg-primary/10 pl-[calc(0.5rem-2px)] pr-2 font-semibold text-primary";
    const inactiveClasses = isSub
      ? "px-2 font-normal text-foreground/80 hover:bg-muted/50 hover:text-foreground"
      : "px-2 font-medium text-foreground hover:bg-muted/50 hover:text-primary";
    return (
      <Link
        key={it.to}
        to={it.to}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "group flex items-center gap-2 rounded-md py-1.5 transition-colors",
          active ? activeClasses : inactiveClasses,
        )}
      >
        <it.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-current")} />
        <span className="flex-1">{it.label}</span>
        {it.badge && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{it.badge}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r bg-card transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Wrench className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">QAIL CMS</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {NAV.map((section) => {
            // Admin section gate
            if (section.label === "Admin" && !me?.isAdmin) return null;

            const modules = (section.modules ?? [])
              .filter((m) => !m.adminOnly || me?.isAdmin)
              .filter((m) => m.items.some(isVisible));
            const flatItems = (section.items ?? []).filter(isVisible);
            const hasContent = !!section.dashboard || modules.length > 0 || flatItems.length > 0;
            if (!hasContent) return null;

            return (
              <div key={section.label} className="mt-4 first:mt-0">
                <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
                <div className="mt-1 space-y-0.5">
                  {section.dashboard && renderLeaf(section.dashboard, "dashboard")}
                  {flatItems.map((it) => renderLeaf(it, "dashboard"))}
                  {modules.map((mod) => {
                    const key = section.label + "::" + mod.label;
                    const autoOpen = location.pathname.startsWith(mod.matchPrefix);
                    const open = moduleOpen[key] ?? autoOpen;
                    const visibleItems = mod.items.filter(isVisible);
                    return (
                      <div key={mod.label} className="mt-1">
                        <button
                          type="button"
                          onClick={() => toggleModule(key, autoOpen)}
                          className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 hover:text-primary"
                        >
                          <mod.icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
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
        <div className="border-t p-3">
          <div className="mb-2 truncate text-xs text-muted-foreground">{me?.email}</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {me?.primaryRole === "guest" || me?.isGuest ? (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Guest (읽기)</span>
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
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBrandHeader onMobileMenu={() => setMobileOpen(true)} />
        <UpdateAvailableBanner />
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}