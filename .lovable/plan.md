## 사이드메뉴 재구성 계획 (v2)

현재 모든 항목이 "Closure Document" 하나에 평평하게 나열되어 있어 가독성이 낮습니다. 이를 **Outstanding Work / Close-Out Doc / Admin** 3개 섹션으로 나누고, 각 섹션의 최상단에 **섹션 대시보드**를 두어 섹션 진입 시 해당 대시보드로 이동시킵니다. 각 모듈은 접이식 서브그룹으로 구성합니다.

### 최종 사이드바 구조

```
── OUTSTANDING WORK ──
· Dashboard                          → /outstanding/dashboard
▸ Task Management
    · Raw Data
    · Tree View
    · Import Logs           (editor)
▸ Defect Management
    · Dashboard  (모듈 단위)
    · Raw Data
    · Import                (editor)
    · Import Logs           (editor)
    · Settings              (admin)

── CLOSE-OUT DOC ──
· Dashboard                          → /closeout/dashboard
▸ As Built Drawing
    · Raw Data
    · Import                (editor)
    · Import Logs           (editor)
    · Settings              (admin)
▸ Spare Part
    · Raw Data
    · Import                (editor)
    · Import Logs           (editor)
    · Aconex Sync           (editor)
▸ Warranty & License        (placeholder, "Soon" 배지, 비활성)

── ADMIN ──  (admin 계정만 노출)
· Overview
· 사용자
· Mapping
· Task 임계값
```

### 섹션 대시보드 처리

- **Outstanding Work Dashboard** (`/outstanding/dashboard`, 신규 라우트): Task 요약 카드 + Defect 요약 카드(기존 Defect Dashboard의 핵심 KPI 미러링). 상세는 각 모듈 페이지로 이동 유도.
- **Close-Out Doc Dashboard** (`/closeout/dashboard`, 신규 라우트): ABD / Spare Part 진행 요약 카드. Warranty & License는 placeholder 카드.
- 두 대시보드 모두 신규 `_authenticated` 하위 라우트 파일 생성. 초기 구현은 **기존 데이터 훅을 재사용한 요약 카드 세트**로 구성(신규 집계 로직 없음).
- 기존 `/closure/dashboard`는 **`/outstanding/dashboard`로 302 리다이렉트**(기본 진입 시 Outstanding으로) 처리하여 링크 호환성 유지. 기존 `/closure/defect-management/dashboard`는 모듈 단위 상세 대시보드로 유지.

> 라우트 prefix를 `/closure/*`에서 새 섹션 prefix로 바꾸지 않습니다. 사이드바 표시상의 그룹만 재편하며, 기존 라우트 경로는 그대로 두고 신규 대시보드 2개만 추가합니다. (경로 대이동은 별도 리팩토링 스코프)

### 동작 규칙

1. **섹션 헤더**: `OUTSTANDING WORK`, `CLOSE-OUT DOC`, `ADMIN` uppercase 라벨.
2. **섹션 진입 = Dashboard 진입**: 섹션 헤더 아래 첫 항목은 항상 해당 섹션 Dashboard 링크. 사이드바에서 섹션 헤더 자체 클릭은 하지 않고, 바로 아래 Dashboard 링크가 진입점.
3. **모듈 그룹**: 접기/펼치기 가능. 현재 라우트가 해당 모듈 prefix에 속하면 자동 펼침. 그 외는 접힘. 접힘 상태는 localStorage 유지.
4. **하위 라벨 정리**: 모듈 접두어 제거 → `Raw Data`, `Import`, `Import Logs`, `Settings` 등 짧은 이름.
5. **권한 필터**: 기존 `adminOnly` / `editorOnly` 유지. 모듈 내 항목이 모두 숨겨지면 모듈 자체를 렌더링하지 않음.
6. **Warranty & License**: 라우트 미구현 → disabled + `Soon` 배지.
7. **모바일**: 기존 `mobileOpen` 동작 유지.

### 구현 산출물

- **수정**: `src/components/layout/AppLayout.tsx` — NAV 구조를 `Section → Module → Leaf` 3계층으로 재작성, Collapsible 서브그룹 로직 추가.
- **신규 라우트 2개**:
  - `src/routes/_authenticated/outstanding/dashboard.tsx` — Task/Defect 요약 카드.
  - `src/routes/_authenticated/closeout/dashboard.tsx` — ABD/Spare Part 요약 카드 + Warranty placeholder.
- **신규 컴포넌트 2개** (요약 카드 조립용):
  - `src/components/dashboards/OutstandingDashboardPage.tsx`
  - `src/components/dashboards/CloseOutDashboardPage.tsx`
- **수정**: `src/routes/_authenticated/closure/dashboard.tsx` — `/outstanding/dashboard`로 redirect.
- 기존 라우트 경로/비즈니스 로직 변경 없음, DB 스키마 변경 없음.
