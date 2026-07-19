import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersionCheck } from "@/hooks/useVersionCheck";

export function UpdateAvailableBanner() {
  const { updateAvailable, dismiss, reloadNow } = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-14 z-30 flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary shadow-sm print:hidden"
    >
      <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="flex-1 font-medium">
        새 버전이 배포되었습니다. 새로고침 후 최신 상태로 사용해 주세요.
      </span>
      <Button size="sm" onClick={reloadNow} className="h-7">
        지금 새로고침
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={dismiss}
        aria-label="나중에 알림 닫기"
        className="h-7 w-7 text-primary hover:bg-primary/20"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}