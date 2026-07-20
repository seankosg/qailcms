import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getUserViewPreference,
  upsertUserViewPreference,
  type ViewPreferenceState,
} from "@/lib/task-management/user-view-preferences.functions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/integrations/supabase/client";

async function hasActiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  } catch {
    return false;
  }
}

function localKey(userId: string, viewKey: string) {
  return `qail.view-pref:${viewKey}:${userId}`;
}

function readLocal(userId: string | null, viewKey: string): ViewPreferenceState | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(localKey(userId, viewKey));
    if (!raw) return null;
    return JSON.parse(raw) as ViewPreferenceState;
  } catch {
    return null;
  }
}

function writeLocal(userId: string | null, viewKey: string, state: ViewPreferenceState) {
  if (!userId) return;
  try {
    localStorage.setItem(localKey(userId, viewKey), JSON.stringify(state));
  } catch {
    // ignore
  }
}

/**
 * 계정 단위(서버 저장 + 로컬 캐시) view 설정 훅.
 *
 * - 최초 마운트 시 로컬 캐시가 있으면 즉시 반환 (오프라인/느린 네트워크에도 깜빡임 없음)
 * - 서버 응답 도착 시 서버 값이 우선 (교차 기기 동기화)
 * - 서버에 저장된 값이 없고 로컬 캐시가 있으면 → 자동으로 서버에 마이그레이션
 * - `save(state)` 는 debounce(400ms) 후 서버 upsert + 로컬 캐시 동기화
 */
export function useUserViewPreference(viewKey: string) {
  const { data: currentUser } = useCurrentUser();
  const userId = currentUser?.id ?? null;
  const queryClient = useQueryClient();
  const getFn = useServerFn(getUserViewPreference);
  const upsertFn = useServerFn(upsertUserViewPreference);

  const [initialState] = useState<ViewPreferenceState | null>(() =>
    readLocal(userId, viewKey),
  );

  const queryKey = ["user-view-pref", viewKey, userId] as const;
  const query = useQuery({
    queryKey,
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await getFn({ data: { viewKey } });
      return res?.state ?? null;
    },
  });

  // 서버 응답 도착 시 로컬 캐시 동기화 + 서버가 비었으면 로컬 값 마이그레이션
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!userId || query.isPending || query.isError) return;
    const server = query.data ?? null;
    if (server) {
      writeLocal(userId, viewKey, server);
      return;
    }
    if (migratedRef.current) return;
    const local = readLocal(userId, viewKey);
    if (local && Object.keys(local).length > 0) {
      migratedRef.current = true;
      (async () => {
        if (!(await hasActiveSession())) {
          migratedRef.current = false;
          return;
        }
        upsertFn({ data: { viewKey, state: local } }).catch(() => {
          migratedRef.current = false;
        });
      })();
    }
  }, [userId, viewKey, query.data, query.isPending, query.isError, upsertFn]);

  const mutation = useMutation({
    mutationFn: (state: ViewPreferenceState) =>
      upsertFn({ data: { viewKey, state } }),
    onError: () => {
      // 세션 만료/사인아웃 중 저장 시도는 조용히 무시 (로컬 캐시는 유지)
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(
    (state: ViewPreferenceState) => {
      writeLocal(userId, viewKey, state);
      queryClient.setQueryData(queryKey, state);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!userId) return;
        void (async () => {
          if (!(await hasActiveSession())) return;
          mutation.mutate(state);
        })();
      }, 400);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, viewKey, mutation.mutate],
  );

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const state: ViewPreferenceState | null =
    query.data ?? initialState ?? null;
  const ready = !!userId && (!query.isPending || initialState != null);

  return { state, ready, save };
}