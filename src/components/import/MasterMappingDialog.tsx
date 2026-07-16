/**
 * Import 파이프라인에서 Subcontractor/Sub-Sub/HDEC PIC/HDEC Eng 등의 이름을
 * 마스터 옵션과 유사 매칭 후 사용자가 개별 승인하는 다이얼로그.
 *
 * 사용 흐름:
 *  1. 상위에서 collectUnresolvedNames() 로 목록을 만들어 `entries` 로 전달.
 *  2. 사용자가 각 이름에 대해 map(후보 선택) / register(신규 등록) / skip(원본 유지) 선택.
 *  3. 확인 시 onApply(decisions) 로 결정이 반환됨. register 는 서버에 addMasterName 도 실행.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { addMasterName } from "@/lib/admin/users.functions";
import type {
  NameDecision,
  UnresolvedNameEntry,
} from "@/lib/import/master-name-validation";
import type { MasterKind, MasterOption } from "@/hooks/useMasterOptions";
import { MASTER_OPTIONS_QK } from "@/hooks/useMasterOptions";

type LocalChoice = {
  action: "map" | "register" | "skip";
  candidateId?: string;
  candidateName?: string;
  /** subsub register 시 상위 협력사 id */
  parentSubId?: string;
};

const MASTER_LABEL: Record<MasterKind, string> = {
  subcontractor: "Subcontractor",
  subsub: "Sub-Sub",
  hdec_pic: "HDEC PIC",
  hdec_eng: "HDEC Eng",
};

export interface MasterMappingDialogProps {
  open: boolean;
  onClose: () => void;
  entries: UnresolvedNameEntry[];
  canRegister: boolean;
  /** register 실행 시 subsub 의 parent 선택이 필요한 경우 사용. 지금은 미지원 — subsub 는 skip/map 만 허용. */
  optionsByKind: Record<MasterKind, readonly MasterOption[]>;
  onApply: (decisions: Map<string, NameDecision>) => void;
}

export function MasterMappingDialog({
  open,
  onClose,
  entries,
  canRegister,
  optionsByKind,
  onApply,
}: MasterMappingDialogProps) {
  const qc = useQueryClient();
  const addMaster = useServerFn(addMasterName);
  const [choices, setChoices] = useState<Map<string, LocalChoice>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  // 초기값: 후보 첫 번째로 자동 preselect (있으면 map, 없으면 skip)
  useEffect(() => {
    if (!open) return;
    setChoices(() => {
      const m = new Map<string, LocalChoice>();
      for (const e of entries) {
        if (e.candidates.length > 0) {
          const c = e.candidates[0];
          m.set(e.key, {
            action: "map",
            candidateId: c.option.id,
            candidateName: c.option.name,
          });
        } else {
          m.set(e.key, { action: "skip" });
        }
      }
      return m;
    });
  }, [open, entries]);

  const grouped = useMemo(() => {
    const g: Record<MasterKind, UnresolvedNameEntry[]> = {
      subcontractor: [],
      subsub: [],
      hdec_pic: [],
      hdec_eng: [],
    };
    for (const e of entries) g[e.masterKind].push(e);
    return g;
  }, [entries]);

  const setChoice = (key: string, next: LocalChoice) => {
    setChoices((prev) => {
      const m = new Map(prev);
      m.set(key, next);
      return m;
    });
  };

  const handleApply = async () => {
    setSubmitting(true);
    try {
      // 1) register 결정 처리 — 서버에 마스터 등록. subsub 는 미지원.
      const toRegister = entries.filter((e) => {
        const c = choices.get(e.key);
        return c?.action === "register";
      });
      for (const e of toRegister) {
        const c = choices.get(e.key);
        if (e.masterKind === "hdec_pic" || e.masterKind === "hdec_eng") {
          toast.error(
            `${e.rawName}: HDEC PIC/ENG는 사용자관리에서만 등록됩니다. skip 또는 map을 선택하세요.`,
          );
          continue;
        }
        if (e.masterKind === "subsub") {
          if (!c?.parentSubId) {
            toast.error(`${e.rawName}: 상위 협력사를 선택하세요.`);
            continue;
          }
          try {
            await addMaster({
              data: {
                kind: "subsub",
                name: e.rawName,
                parent_id: c.parentSubId,
              },
            });
            await qc.invalidateQueries({ queryKey: MASTER_OPTIONS_QK("subsub") });
            toast.success(`Sub-Sub "${e.rawName}" 등록`);
          } catch (err: any) {
            toast.error(`${e.rawName} 등록 실패: ${err?.message ?? err}`);
          }
          continue;
        }
        try {
          await addMaster({
            data: { kind: "subcontractor", name: e.rawName },
          });
          await qc.invalidateQueries({ queryKey: MASTER_OPTIONS_QK(e.masterKind) });
          toast.success(`${MASTER_LABEL[e.masterKind]} "${e.rawName}" 등록`);
        } catch (err: any) {
          toast.error(`${e.rawName} 등록 실패: ${err?.message ?? err}`);
        }
      }

      // 2) 결정을 NameDecision map 으로 변환
      const decisions = new Map<string, NameDecision>();
      for (const e of entries) {
        const c = choices.get(e.key);
        if (!c) continue;
        if (c.action === "skip") {
          decisions.set(e.key, { action: "skip" });
        } else if (c.action === "map" && c.candidateName) {
          decisions.set(e.key, { action: "map", mappedName: c.candidateName });
        } else if (c.action === "register") {
          // 등록된 이름은 rawName 그대로 사용 (canonical name = 원본 그대로)
          decisions.set(e.key, { action: "register", mappedName: e.rawName });
        }
      }
      onApply(decisions);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const kinds = (Object.keys(grouped) as MasterKind[]).filter(
    (k) => grouped[k].length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>마스터 이름 유사 매칭 검토</DialogTitle>
          <DialogDescription>
            원본 파일의 이름이 마스터에 정확히 일치하지 않습니다. 각 항목의 처리 방식을 선택하세요.
            <br />
            <span className="text-xs">
              · <b>매핑</b>: 유사 후보로 자동 교체 · <b>신규 등록</b>: 마스터에 새로 추가(admin) · <b>건너뛰기</b>: 원본 이름 유지
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">검토가 필요한 이름이 없습니다.</p>
          ) : (
            kinds.map((k) => (
              <div key={k} className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">
                  {MASTER_LABEL[k]} ({grouped[k].length})
                </h4>
                <div className="space-y-2">
                  {grouped[k].map((e) => {
                    const c = choices.get(e.key) ?? { action: "skip" as const };
                    return (
                      <div
                        key={e.key}
                        className="rounded border p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-medium">{e.rawName}</span>{" "}
                            <Badge variant="secondary" className="text-[10px]">
                              {e.occurrences}회
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {e.candidates.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              유사 후보 없음
                            </span>
                          )}
                          {e.candidates.map((cand) => {
                            const active =
                              c.action === "map" &&
                              c.candidateId === cand.option.id;
                            return (
                              <button
                                key={cand.option.id}
                                type="button"
                                onClick={() =>
                                  setChoice(e.key, {
                                    action: "map",
                                    candidateId: cand.option.id,
                                    candidateName: cand.option.name,
                                  })
                                }
                                className={`rounded border px-2 py-1 text-xs transition ${
                                  active
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "hover:bg-accent"
                                }`}
                              >
                                {cand.option.name}{" "}
                                <span className="text-[10px] text-muted-foreground">
                                  ({Math.round(cand.score * 100)}%)
                                </span>
                              </button>
                            );
                          })}
                          {canRegister && e.masterKind !== "subsub" && (
                            <button
                              type="button"
                              onClick={() =>
                                setChoice(e.key, { action: "register" })
                              }
                              className={`rounded border px-2 py-1 text-xs transition ${
                                c.action === "register"
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "hover:bg-accent"
                              }`}
                            >
                              신규 등록 "{e.rawName}"
                            </button>
                          )}
                          {canRegister && e.masterKind === "subsub" && (
                            <button
                              type="button"
                              onClick={() =>
                                setChoice(e.key, {
                                  action: "register",
                                  parentSubId: c.parentSubId,
                                })
                              }
                              className={`rounded border px-2 py-1 text-xs transition ${
                                c.action === "register"
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "hover:bg-accent"
                              }`}
                            >
                              신규 등록 "{e.rawName}"
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setChoice(e.key, { action: "skip" })
                            }
                            className={`rounded border px-2 py-1 text-xs transition ${
                              c.action === "skip"
                                ? "border-muted-foreground bg-muted"
                                : "hover:bg-accent"
                            }`}
                          >
                            건너뛰기(원본 유지)
                          </button>
                        </div>
                        {e.masterKind === "subsub" && c.action === "register" && (
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">상위 협력사:</span>
                            <select
                              className="rounded border bg-background px-2 py-1 text-xs"
                              value={c.parentSubId ?? ""}
                              onChange={(ev) =>
                                setChoice(e.key, {
                                  action: "register",
                                  parentSubId: ev.target.value || undefined,
                                })
                              }
                            >
                              <option value="">선택…</option>
                              {optionsByKind.subcontractor.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button onClick={handleApply} disabled={submitting || entries.length === 0}>
            {submitting ? "적용 중…" : "적용"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}