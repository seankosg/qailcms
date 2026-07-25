## 문제 진단 (확인된 사실)

프로덕션 번들을 실측한 결과 **클라이언트 JS 어디에도 buildId 문자열이 포함되어 있지 않음**:

- 서버(edge worker) 응답: `GET https://qailcms.com/api/public/version` → `{"buildId":"2026-07-25T05:33:20.810Z"}` ✅ 정상
- 클라이언트 번들: 모든 `/assets/*.js`에서 `2026-...Z` 패턴 검색 → **0건**. 즉 `__APP_BUILD_ID__`가 클라이언트에서 미치환.

결과적으로 `useVersionCheck`의 `getCurrentBuildId()`가 `""`을 반환 → `isDevBuild("")`가 `true` → **버전 체크 자체가 조기 리턴**됩니다. 같은 이유로 헤더의 "New Version" 버튼도 렌더링되지 않습니다.

**원인**: `vite.config.ts`의 최상위 `vite.define`이 Vite 7 멀티 환경 빌드에서 SSR/worker 번들에는 반영되지만, `@lovable.dev/vite-tanstack-config`가 클라이언트 환경에서 `import.meta.env.*` 계열 define만 병합하는 흐름과 어긋나 `__APP_BUILD_ID__` 심볼이 클라이언트 번들에서 치환되지 않고 사라짐(전역 identifier로 남으면 dead-code로 제거).

## 수정 계획

### 1. `vite.config.ts`
buildId를 **VITE_ 접두사 환경변수 형태로도** 주입하여 클라이언트/서버 양쪽에 확실히 치환되게 함:

```ts
const buildId = process.env.VITE_APP_BUILD_ID || new Date().toISOString();

export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
      "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId),
    },
  },
});
```

### 2. `src/hooks/useVersionCheck.ts`
`getCurrentBuildId()`가 `__APP_BUILD_ID__`와 `import.meta.env.VITE_APP_BUILD_ID` 중 실제로 값이 있는 쪽을 사용하도록 폴백 추가.

### 3. `src/components/layout/TopBrandHeader.tsx`
`NewVersionButton`의 `buildId` 읽는 방식을 동일 폴백으로 통일.

### 4. `src/routes/api/public/version.ts`
서버는 이미 정상 응답 중이나, 동일한 폴백을 적용해 향후 정의 방식이 바뀌어도 어긋나지 않게 함.

### 5. `src/vite-env.d.ts`
`interface ImportMetaEnv { readonly VITE_APP_BUILD_ID?: string }` 타입 선언 추가.

## 부가 개선 (같은 턴에 함께 반영)

- **세션 dismiss 무결성**: 현재 module-level `toastShown` 플래그가 한 번 표시되면 이후 새 배포가 나와도 토스트가 다시 뜨지 않습니다. `toastShown`을 **표시한 buildId 기준으로 판정**하도록 변경(신 buildId가 들어오면 재표시).
- **크로스 오리진 302 회피**: `qailcms.lovable.app`에서 접근 시 `/api/public/version`이 `qailcms.com`으로 302됨. 이 경우에도 `fetch`가 리다이렉트를 따라가 200을 받지만, 미래를 위해 `fetch(url, { cache: "no-store", credentials: "omit", redirect: "follow" })` 유지. (별도 코드 변경 불필요, 기록용)

## 검증 계획

1. `tsgo` 타입체크 통과.
2. 빌드 후 `/assets/*.js` 번들에서 buildId 문자열이 실제로 포함되는지 grep으로 확인.
3. 프리뷰에서 `window.__APP_BUILD_ID__` 대신 `import.meta.env.VITE_APP_BUILD_ID` 값이 콘솔에 노출되는지 실행 스니펫으로 검증.
4. `/api/public/version`의 buildId를 임의로 다르게 만드는 시나리오(캐시 삭제 후 재접속)에서 토스트/배너/버튼이 표시되는지 세션 확인.
