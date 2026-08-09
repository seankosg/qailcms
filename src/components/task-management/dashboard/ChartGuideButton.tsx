import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/** S-Curve 사용자 설명서(정적 HTML)를 새 탭으로 여는 버튼 */
export function ChartGuideButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1 text-xs"
      onClick={() => window.open("/guides/tm-scurve-guide.html", "_blank", "noopener")}
    >
      <BookOpen className="h-3.5 w-3.5" />
      차트 보는 법
    </Button>
  );
}
