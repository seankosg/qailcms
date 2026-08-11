import { useState } from "react";
import { SplDocumentPanel } from "@/components/spl/detail/SplDocumentPanel";
import { SplOcsPanel } from "./SplOcsPanel";
import { SplRspPanel } from "./SplRspPanel";

export type SplPanelKind = "ocs" | "rsp" | "documents";
export type SplPanelTarget = { id: string; splNumber: string; kind: SplPanelKind } | null;

/**
 * SPL OCS · RSP · Documents 패널 묶음.
 * Raw Data 와 상세 화면이 동일한 패널을 공유하며, OCS ↔ RSP 상호 이동을 여기서 조정한다.
 */
export function SplOcsPanels({
  target,
  onClose,
}: {
  target: SplPanelTarget;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SplPanelKind | null>(null);
  const [focusRspId, setFocusRspId] = useState<string | null>(null);
  const active = kind ?? target?.kind ?? null;

  if (!target) return null;
  const close = () => {
    setKind(null);
    setFocusRspId(null);
    onClose();
  };

  return (
    <>
      <SplOcsPanel
        splItemId={target.id}
        splNumber={target.splNumber}
        open={active === "ocs"}
        onOpenChange={(v) => !v && close()}
        onOpenRsp={(rspItemId) => {
          setFocusRspId(rspItemId);
          setKind("rsp");
        }}
      />
      <SplRspPanel
        splItemId={target.id}
        splNumber={target.splNumber}
        open={active === "rsp"}
        onOpenChange={(v) => !v && close()}
        focusId={focusRspId}
        onOpenOcs={() => {
          setFocusRspId(null);
          setKind("ocs");
        }}
      />
      <SplDocumentPanel
        splItemId={target.id}
        open={active === "documents"}
        onOpenChange={(v) => !v && close()}
      />
    </>
  );
}
