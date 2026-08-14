import { useCallback, useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type Persister,
} from "@tanstack/react-query-persist-client";

/** PDB 화면이 쓰는 캐시 키 접두어 — 이 키들만 브라우저에 저장한다. */
const PDB_KEY_PREFIXES = [
  "tm-rows-as-of",
  "task-settings",
  "abd-progress",
  "snag-kpi",
  "spl-rows-as-of",
  "pdb-module-filters",
];

const STORAGE_KEY = "qail:pdb-cache:v1";
const MAX_AGE = 24 * 60 * 60 * 1000;

function isPdbKey(key: readonly unknown[]) {
  const head = String(key[0] ?? "");
  return PDB_KEY_PREFIXES.some((p) => head.startsWith(p));
}

function makePersister(): Persister | null {
  if (typeof window === "undefined") return null;
  try {
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 2000,
      // 용량 초과 시 저장을 조용히 포기한다(화면 동작에는 영향 없음).
      retry: () => undefined,
    });
  } catch {
    return null;
  }
}

/**
 * PDB 데이터 캐시를 localStorage 에 저장/복원한다.
 * 새로고침 후에도 직전 값이 즉시 보이고, 필요할 때만 Refresh 로 재조회한다.
 */
export function usePdbCache() {
  const queryClient = useQueryClient();
  const [persister, setPersister] = useState<Persister | null>(null);
  const [restored, setRestored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const p = makePersister();
    if (!p) {
      setRestored(true);
      return;
    }
    setPersister(p);
    void persistQueryClientRestore({ queryClient, persister: p, maxAge: MAX_AGE })
      .catch(() => undefined)
      .finally(() => {
        // PDB 진입 시 복원된 캐시를 즉시 stale 로 보지 않도록 무제한 유효로 설정.
        // Refresh 버튼을 누르기 전까지는 기존 캐시값을 그대로 보여준다.
        for (const prefix of PDB_KEY_PREFIXES) {
          queryClient.setQueryDefaults([prefix], { staleTime: Infinity });
        }
        setRestored(true);
        unsubscribe = persistQueryClientSubscribe({
          queryClient,
          persister: p,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) => q.state.status === "success" && isPdbKey(q.queryKey),
          },
        });
      });
    return () => unsubscribe?.();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await persister?.removeClient();
      await refetchPdb(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [persister, queryClient]);

  return { restored, refresh, refreshing };
}

async function refetchPdb(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    predicate: (q) => isPdbKey(q.queryKey),
    refetchType: "active",
  });
}