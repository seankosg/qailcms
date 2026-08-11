import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
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

type Mut<T> = UseMutationResult<unknown, Error, T>;

/**
 * OCS/RSP 사용자 편집 뮤테이션 묶음.
 * 성공 시 패널과 Raw Data 캐시(spl_items 파생) 조회를 함께 무효화한다.
 */
export function useSplOcsMutations(splItemId: string) {
  const qc = useQueryClient();
  const complied = useServerFn(setSplOcsComplied);
  const category = useServerFn(setSplOcsCategory);
  const categoryUpsert = useServerFn(upsertSplOcsCategory);
  const commentUpsert = useServerFn(upsertSplOcsComment);
  const commentOff = useServerFn(deactivateSplOcsComment);
  const rspLink = useServerFn(setSplOcsRspLink);
  const rspUpsert = useServerFn(upsertSplRspItem);
  const rspOff = useServerFn(deactivateSplRspItem);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["spl-ocs-comments", splItemId] }),
      qc.invalidateQueries({ queryKey: ["spl-rsp-items", splItemId] }),
      qc.invalidateQueries({ queryKey: ["spl-rows-as-of"] }),
    ]);
  };
  const opts = (ok: string) => ({
    onSuccess: async () => {
      await invalidate();
      toast.success(ok);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    setComplied: useMutation({
      mutationFn: (data: { commentId: string; expected: boolean; complied: boolean }) => complied({ data }),
      ...opts("Complied updated"),
    }) as Mut<{ commentId: string; expected: boolean; complied: boolean }>,
    setCategory: useMutation({
      mutationFn: (data: { commentId: string; categoryId: string; on: boolean }) => category({ data }),
      ...opts("Category updated"),
    }) as Mut<{ commentId: string; categoryId: string; on: boolean }>,
    upsertCategory: useMutation({
      mutationFn: (data: { id: string | null; code: string; label: string; isActive: boolean }) =>
        categoryUpsert({ data }),
      ...opts("Category saved"),
    }) as Mut<{ id: string | null; code: string; label: string; isActive: boolean }>,
    upsertComment: useMutation({
      mutationFn: (data: {
        id: string | null;
        splItemId: string;
        ocsNumber: string;
        revision: string;
        commentText: string;
        contractorResponse: string | null;
        assessedCode: string;
        signOffStatus: string;
      }) => commentUpsert({ data }),
      ...opts("OCS comment saved"),
    }),
    deactivateComment: useMutation({
      mutationFn: (data: { id: string; reason: string }) => commentOff({ data }),
      ...opts("OCS comment deactivated"),
    }) as Mut<{ id: string; reason: string }>,
    setRspLink: useMutation({
      mutationFn: (data: { commentId: string; rspItemId: string; on: boolean }) => rspLink({ data }),
      ...opts("RSP link updated"),
    }) as Mut<{ commentId: string; rspItemId: string; on: boolean }>,
    upsertRsp: useMutation({
      mutationFn: (data: {
        id: string | null;
        splItemId: string;
        description: string | null;
        manufacturer: string | null;
        model: string | null;
        unit: string | null;
        qtyRequired: number | null;
        qtyAvailable: number | null;
        qtyShort: number | null;
      }) => rspUpsert({ data }),
      ...opts("RSP item saved"),
    }),
    deactivateRsp: useMutation({
      mutationFn: (data: { id: string; reason: string }) => rspOff({ data }),
      ...opts("RSP item deactivated"),
    }) as Mut<{ id: string; reason: string }>,
  };
}
