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
  const [secondary, setSecondary] = useState<SplPanelKind | null>(null);
  const [focusRspId, setFocusRspId] = useState<string | null>(null);
  const primary = kind ?? target?.kind ?? null;

  if (!target) return null;
  const close = () => {
    setKind(null);
    setSecondary(null);
    setFocusRspId(null);
    onClose();
  };
  const dual = secondary !== null;
  const isOpen = (k: SplPanelKind) => primary === k || secondary === k;
  const sideOf = (k: SplPanelKind): "left" | "right" => (secondary === k ? "left" : "right");
  /** 반대편 패널을 열고/닫는다. 현재 패널은 닫지 않는다. */
  const toggleSecondary = (k: SplPanelKind) => setSecondary((prev) => (prev === k ? null : k));
  /** 패널별 닫기: 좌측(보조) 패널이면 그것만 닫고, 우측(정본)이면 전체를 닫는다. */
  const closeOne = (k: SplPanelKind) => (secondary === k ? setSecondary(null) : close());

  return (
    <>
      <SplOcsPanel
        splItemId={target.id}
        splNumber={target.splNumber}
        open={isOpen("ocs")}
        side={sideOf("ocs")}
        dual={dual}
        onToggleCounterpart={primary === "ocs" ? () => toggleSecondary("rsp") : undefined}
        onOpenChange={(v) => !v && closeOne("ocs")}
        onOpenRsp={(rspItemId) => {
          setFocusRspId(rspItemId);
          if (primary === "rsp") return;
          setSecondary("rsp");
        }}
      />
      <SplRspPanel
        splItemId={target.id}
        splNumber={target.splNumber}
        open={isOpen("rsp")}
        side={sideOf("rsp")}
        dual={dual}
        onToggleCounterpart={primary === "rsp" ? () => toggleSecondary("ocs") : undefined}
        onOpenChange={(v) => !v && closeOne("rsp")}
        focusId={focusRspId}
        onOpenOcs={() => {
          setFocusRspId(null);
          if (primary === "ocs") return;
          setSecondary("ocs");
        }}
      />
      <SplDocumentPanel
        splItemId={target.id}
        open={primary === "documents"}
        onOpenChange={(v) => !v && close()}
      />
    </>
  );
}
