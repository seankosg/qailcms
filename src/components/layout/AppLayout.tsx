import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Database, Upload, FileClock, RefreshCw, LogOut, Menu, ChevronDown, Package, Wrench, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };
type NavGroup = { label: string; icon: typeof Package; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Closure Document",
    icon: Package,
    items: [
      { to: "/closure/spare-part/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/closure/spare-part/raw-data", label: "Raw Data", icon: Database },
      { to: "/closure/spare-part/import", label: "Import", icon: Upload, adminOnly: true },
      { to: "/closure/spare-part/import/logs", label: "Import Logs", icon: FileClock, adminOnly: true },
      { to: "/closure/spare-part/aconex-sync", label: "Aconex Sync", icon: RefreshCw, adminOnly: true },
    ],
  },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: me } = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
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
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <group.icon className="h-3.5 w-3.5" />
                {group.label}
              </div>
              <div className="mt-1 space-y-0.5">
                {group.items
                  .filter((it) => !it.adminOnly || me?.isAdmin)
                  .map((it) => {
                    const active = location.pathname.startsWith(it.to);
                    return (
                      <Link
                        key={it.to}
                        to={it.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          active ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                        )}
                      >
                        <it.icon className="h-4 w-4" />
                        {it.label}
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 truncate text-xs text-muted-foreground">{me?.email}</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {me?.isAdmin && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <ShieldCheck className="h-3 w-3" />
                {me.isSuperUser ? "Superuser" : "Admin"}
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
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-card px-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">QAIL CMS</span>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}