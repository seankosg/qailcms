/**
 * Import 화면에서 마스터 이름 유사 매칭 검토를 위한 공용 섹션.
 * - 미해결 이름이 있으면 Alert + 검토 버튼을 렌더.
 * - 버튼 클릭 시 MasterMappingDialog 오픈. 적용 시 onApply(decisions) 호출.
 */
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MasterMappingDialog } from "./MasterMappingDialog";
import type { UnresolvedNameEntry, NameDecision } from "@/lib/import/master-name-validation";
import type { MasterKind, MasterOption } from "@/hooks/useMasterOptions";

export interface MasterMappingSectionProps {
  entries: UnresolvedNameEntry[];
  canRegister: boolean;
  optionsByKind: Record<MasterKind, readonly MasterOption[]>;
  onApply: (decisions: Map<string, NameDecision>) => void;
}

export function MasterMappingSection({
  entries,
  canRegister,
  optionsByKind,
  onApply,
}: MasterMappingSectionProps) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <>
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>마스터에 정확히 일치하지 않는 이름 {entries.length}건</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            Subcontractor/Sub-Sub/HDEC PIC/Eng 이름 중 마스터와 다른 값이 감지되었습니다. 검토 후 매핑하거나 원본을 유지하세요.
          </span>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            이름 매핑 검토
          </Button>
        </AlertDescription>
      </Alert>
      <MasterMappingDialog
        open={open}
        onClose={() => setOpen(false)}
        entries={entries}
        canRegister={canRegister}
        optionsByKind={optionsByKind}
        onApply={onApply}
      />
    </>
  );
}