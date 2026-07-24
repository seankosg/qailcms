# My Work Space — 최종 계획 (Admin 전체 열람 추가)

## 1. 사이드바
`AppLayout.tsx` NAV 최상단에 "MY WORK SPACE" 섹션 추가 (`/my-work-space`, User 아이콘). 모든 인증 사용자에게 노출.

## 2. 라우트 / 파일
- `src/routes/_authenticated/my-work-space.tsx`
- `src/components/my-work-space/MyWorkSpacePage.tsx`
- `src/components/my-work-space/ModuleKpiCard.tsx`
- `src/components/my-work-space/ModuleRowList.tsx`
- `src/hooks/useMyWorkspaceData.ts`

## 3. 데이터 조회 (Admin 예외 포함)

`useCurrentUser()`에서 `isAdmin`, `hdec_pic_name`를 읽어 필터 결정:

```ts
const filterPic = me.isAdmin ? null : me.hdec_pic_name;
// filterPic === null: WHERE 절에 hdec_pic_name 조건 미적용 → 전체 조회
// 그 외: WHERE hdec_pic_name = filterPic
```

- **Admin (admin / superuser)**: 담당자 필터 없이 TM/SM/ABD 전체 데이터 조회
- **일반 사용자**: 본인 `hdec_pic_name`으로 필터
- **`hdec_pic_name`이 null인 비-Admin 사용자**: "프로필에 HDEC PIC가 지정되지 않았습니다" 안내

상한: 개인 2,000행 / Admin 5,000행. 초과 시 배지 안내 및 "Raw Data에서 전체 보기" 링크.

## 4. 페이지 헤더 표기

- 개인: `My Work Space · 담당자(HDEC PIC): <이름>`
- Admin: `My Work Space · 관리자 전체 보기` 배지 표시로 스코프 인지도 확보

## 5. KPI 카드 (5종, 시인성 강조 디자인)

카드 구성 (Total / WIP / 지연 / 임박 / 완료), 각 카드에 값 + `%(대비 Total)` 표시.

**시인성 강조 스펙**
- 좌측 4px 컬러 바 + 카드 상단 상태 dot + uppercase 라벨
- 상태 컬러: WIP=info(파랑) · 지연=destructive(빨강) · 임박=warning(앰버, 값>0 시 컬러 바 `animate-pulse`) · 완료=success(초록) · Total=중립
- 큰 숫자 `text-4xl font-bold tabular-nums` + 옆 `%` pill 배지
- 카드 하단 2px progress bar (상태색)
- Hover `shadow-md`+`ring-primary/30`, 클릭 시 하단 리스트박스 해당 탭 자동 선택 + 스크롤
- `src/styles.css`에 `--info/--warning/--success` 토큰 없으면 oklch로 신규 정의(light/dark)
- 반응형: `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`

## 6. 리스트박스 (탭 + 스크롤 + 드릴다운)

- 탭: `[전체 N] [위험 N] [임박 N]` (기본: 전체)
  - 위험/임박 판정은 KPI와 동일 로직
- 높이 ≈ 10행 (`max-h-[440px] overflow-y-auto`), sticky header
- 정렬: 모듈 기본 정렬 (TM: task_no, SM: issue_no, ABD: drawing_no)
- 컬럼:
  - TM: Task No · Task · P.Finish · Actual% · 판정
  - SM: Issue No · Location · Trade · Reported · Status
  - ABD: Drawing No · Title · Round · Plan Date · Status
- Admin 모드일 때만 각 리스트 첫 컬럼 앞에 "HDEC PIC" 컬럼 추가 표시 (담당자 식별)
- 행 클릭 드릴다운:
  - TM → `/closure/task-management/detail/$id`
  - SM → `/closure/snag-management/detail/$id`
  - ABD → `AbdDetailSheet` 오픈
- 빈 상태: "해당 조건 항목 없음"

## 7. 페이지 레이아웃

```
[Header: My Work Space · 담당자/관리자 모드 배지]

── Task Management ──
[Total][WIP][지연][임박][완료]
[전체][위험][임박] 탭
스크롤 리스트박스

── Snag List ──   동일 패턴
── As Built Drawing ──   동일 패턴
```

## 8. 변경 요약

- 추가 5개 파일 (라우트/페이지/카드/리스트/훅)
- 수정: `AppLayout.tsx` (NAV), `src/styles.css` (상태 토큰 필요 시)

DB/서버 함수 변경 없음. Admin 전체 조회는 기존 테이블 RLS 정책(Admin 전체 접근 허용)에 의존.
