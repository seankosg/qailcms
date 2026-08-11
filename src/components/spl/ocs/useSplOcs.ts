import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  deactivateSplOcsComment,
  deactivateSplRspItem,
  listSplOcsComments,
  listSplRspItems,
  setSplOcsCategory,
  setSplOcsComplied,
  setSplOcsRspLink,
  upsertSplOcsCategory,
  upsertSplOcsComment,
  upsertSplRspItem,
} from "@/lib/spl/ocs.functions";

export function useSplOcsComments(splItemId: string, enabled: boolean) {
  const fn = useServerFn(listSplOcsComments);
  return useQuery({
    queryKey: ["spl-ocs-comments", splItemId],
    queryFn: () => fn({ data: { splItemId } }),
    enabled: enabled && !!splItemId,
  });
}

export function useSplRspItems(splItemId: string, enabled: boolean) {
  const fn = useServerFn(listSplRspItems);
  return useQuery({
    queryKey: ["spl-rsp-items", splItemId],
    queryFn: () => fn({ data: { splItemId } }),
    enabled: enabled && !!splItemId,
  });
}

/** 편집 성공 시 캐시(spl_items) 재계산 결과까지 화면에 반영 */
export function useSplOcsMutations(splItemId: string) {
  const qc = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["spl-ocs-comments", splItemId] }),
      qc.invalidateQueries({ queryKey: ["spl-rsp-items", splItemId] }),
      qc.invalidateQueries({ queryKey: ["spl-rows-as-of"] }),
    ]);
  };
  const onError = (e: unknown) => toast.error((e as Error).message);

  const mk = <T,>(fn: (args: { data: T }) => Promise<unknown>, ok: string) =>
    useMutation({
      mutationFn: (data: T) => fn({ data }),
      onSuccess: async () => {
        await invalidate();
        toast.success(ok);
      },
      onError,
    });

  return {
    setComplied: mk(useServerFn(setSplOcsComplied), "Complied updated"),
    setCategory: mk(useServerFn(setSplOcsCategory), "Category updated"),
    upsertCategory: mk(useServerFn(upsertSplOcsCategory), "Category saved"),
    upsertComment: mk(useServerFn(upsertSplOcsComment), "OCS comment saved"),
    deactivateComment: mk(useServerFn(deactivateSplOcsComment), "OCS comment deactivated"),
    setRspLink: mk(useServerFn(setSplOcsRspLink), "RSP link updated"),
    upsertRsp: mk(useServerFn(upsertSplRspItem), "RSP item saved"),
    deactivateRsp: mk(useServerFn(deactivateSplRspItem), "RSP item deactivated"),
  };
}
