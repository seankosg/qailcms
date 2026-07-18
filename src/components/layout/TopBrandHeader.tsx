import { Bell, Menu, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import hyundaiLogo from "@/assets/hyundai-logo.png.asset.json";

interface Props {
  onMobileMenu?: () => void;
}

function NewVersionButton() {
  const buildId = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
  if (!buildId || buildId.startsWith("__") || buildId === "development") {
    return null;
  }
  const handleForceReload = () => {
    window.location.replace(window.location.pathname + "?__reset=" + Date.now());
  };
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleForceReload}
      aria-label="New Version - 강제 새로고침"
      className="hidden sm:inline-flex print:hidden"
    >
      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
      New Version
    </Button>
  );
}

export function TopBrandHeader({ onMobileMenu }: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card px-3 lg:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden shrink-0"
        onClick={onMobileMenu}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <img
        src={hyundaiLogo.url}
        alt="HYUNDAI Engineering & Construction"
        className="h-6 lg:h-7 w-auto shrink-0"
      />

      <span className="hidden sm:inline truncate text-sm font-medium tracking-wide text-muted-foreground">
        QAIL PROJECT COMPLETION MANAGEMENT SYSTEM
      </span>
      <span className="sm:hidden truncate text-sm font-medium tracking-wide text-muted-foreground">
        QAIL CMS
      </span>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <NewVersionButton />
        <span className="hidden md:inline text-xs text-muted-foreground">
          © 2026 QAIL CMS. All rights reserved.
        </span>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}