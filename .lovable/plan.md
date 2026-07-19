# 앱 업데이트 알림 구현 계획 (v2)

## 목표
새 버전 배포 감지 시, **사용자가 명시적으로 확인(닫기/새로고침)하기 전까지는 절대 사라지지 않는** 알림을 표시합니다.

## 알림 UX (핵심 변경)

토스트는 자동으로 사라지는 특성이 있어 요구사항에 부적합합니다. 대신 **비-모달 고정 배너(dismissible sticky banner)** 를 사용합니다.

- 위치: 화면 상단 `TopBrandHeader` 바로 아래, `sticky top-14`로 고정.
- 스타일: primary 색상 배경 + 좌측 아이콘(Sparkles), 우측에 두 개의 버튼.
  - **"지금 새로고침"** — `window.location.replace(pathname + "?__reset=" + Date.now())` 실행.
  - **"나중에"** (X 아이콘) — 배너를 이번 세션에서만 숨김(`sessionStorage`에 감지된 buildId 저장). 이후 **더 새로운 buildId**가 감지되면 다시 표시.
- 모든 페이지에서 항상 노출 (AppLayout 하위).
- 접근성: `role="status"`, `aria-live="polite"`, 포커스 이동 없음.
- 보조 알림: 최초 감지 순간 1회 sonner 토스트(`duration: Infinity`, 닫기 버튼 포함)를 함께 띄워 즉시 인지시키되, **주 알림은 배너**. 토스트가 닫혀도 배너는 유지.
- 기존 `NewVersionButton`도 감지 시 pulse 강조 스타일 적용.

## 감지 방식

- 클라이언트 현재 버전: 번들에 주입된 `__APP_BUILD_ID__`.
- 최신 버전: 신규 공개 엔드포인트 `GET /api/public/version` → `{ buildId }`, `Cache-Control: no-store`.
- 두 값이 다르면 업데이트 감지 상태로 전환.

## 폴링

- 훅 `useVersionCheck()` (`src/hooks/useVersionCheck.ts`).
- 주기: **60초**, `visibilitychange`로 창 재활성화 시 즉시 1회 재조회.
- 개발 모드(`__APP_BUILD_ID__`가 `development` 또는 빈 값)에서는 비활성화.
- 네트워크 오류는 조용히 무시 후 다음 주기 재시도.

## 파일 변경

- 신규
  - `src/routes/api/public/version.ts` — GET 핸들러
  - `src/hooks/useVersionCheck.ts` — 폴링/상태 관리, 최신 감지 buildId 반환
  - `src/components/layout/UpdateAvailableBanner.tsx` — 고정 배너 UI
- 수정
  - `src/components/layout/AppLayout.tsx` — 훅 호출 + 배너 렌더링
  - `src/components/layout/TopBrandHeader.tsx` — `NewVersionButton` 강조 상태 연동

## 한계
- 폴링 방식이라 감지까지 최대 60초 지연 가능. 실시간 push가 꼭 필요하면 Supabase Realtime으로 확장 가능하나 현 요구엔 과함.

승인해 주시면 위 구조로 구현하겠습니다.