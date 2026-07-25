## 계획: My Team Work Space (MTWS) 페이지 구현

### 개념
- **MWS**: 로그인 사용자가 **HDEC PIC**로 지정된 항목만 필터 (개인 담당).
- **MTWS**: 로그인 사용자의 **team**과 동일한 team의 항목을 필터 (팀 담당).
- **Admin / d-superuser**: MWS와 동일하게 필터 없이 **전체 조회**.
- MWS의 UI/컴포넌트(오늘/지연/임박/전체 탭, 좌측 컨텍스트 컬럼, KPI 카드, Columns 메뉴, DataDatePicker 등)를 그대로 재사용. 필터 축만 `hdec_pic_name` → `team`으로 교체.

### 1. 데이터 훅 확장 (`src/hooks/useMyWorkspaceData.ts`)
- 기존 `useMyTasks / useMySnags / useMyAbd`에 파라미터 `mode: "pic" | "team"` 추가.
  - `pic` 모드: 현재대로 `hdec_pic_name` eq.
  - `team` 모드: `team` eq (사용자 `profiles.team` 값 사용).
  - Admin/d-superuser: mode와 무관하게 필터 없이 전체 로드(현행 동일).
- `queryKey`에 `mode`와 필터값을 포함해 캐시 분리.
- 3개 raw 테이블(`task_management_raw`, `defect_items_raw`, `abd_items_raw`) 모두 `team` 컬럼 존재 확인 완료.

### 2. 신규 라우트 (`src/routes/_authenticated/my-team-work-space.tsx`)
- `MyWorkSpacePage`를 그대로 렌더링, `scope="team"` prop 전달.
- `head()`에 팀 워크스페이스용 title/description.

### 3. 페이지 컴포넌트 (`src/components/my-work-space/MyWorkSpacePage.tsx`)
- `scope: "pic" | "team"` prop 신설 (default `"pic"`).
- 상단 제목:
  - `pic`: "My Work Space"
  - `team`: "My Team Work Space — {팀명}" (admin은 "My Team Work Space — 전체")
- 훅 호출:
  - `pic` 모드: 기존대로 `me.hdec_pic_name` 사용.
  - `team` 모드: `me.team` 사용. Admin/d-superuser는 훅 내부에서 필터 무시하고 전체 조회.
  - Non-admin이면서 `me.team`이 비어있으면 "소속 팀 정보가 없습니다" 안내.
- Columns 저장 키(`useMwsColumnPrefs`)에 scope 접미사 추가 (`mws:tm:pic` vs `mws:tm:team`)하여 독립 저장.

### 4. 사이드바 항목 추가 (`src/components/layout/AppLayout.tsx`)
- "My Work Space" 바로 아래에 "My Team Work Space" 메뉴 항목 추가.
- 아이콘: 팀/그룹을 상징하는 lucide `Users` 아이콘 사용 (추후 3D 아이콘 교체 가능).
- 접힘/펼침 상태 모두 반영, Guest 노출 정책은 MWS와 동일.

### 5. 검증 항목
- 타입체크 통과.
- 일반 사용자: 본인 team의 항목만 노출.
- Admin/d-superuser: 전체 항목 노출.
- team이 없는 일반 사용자: 빈 상태 안내.
- Columns 설정이 MWS/MTWS 간 상호 침범 없이 저장·복원.
- 오늘/지연/임박 필터 규칙과 좌측 컨텍스트 컬럼은 MWS와 완전 동일 동작.

### 6. 변경하지 않는 것
- MWS의 기존 로직·판정 기준·필터 정의.
- Raw 테이블 스키마, RLS, RPC.
- 최초 접속 리다이렉트(`/my-work-space` 유지).