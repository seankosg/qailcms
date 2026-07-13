# Snag Raw Data 단계 컬럼 재구성

## 목표
Raw Data 테이블 컬럼을 **Start → Rectified → Closure** 3단계 세트로 정렬하고, 각 세트를 **[Planned Date | Actual Date | Status]** 3열 구성으로 나란히 배치합니다. `Completion`은 UI 라벨만 `Rectified`로 변경합니다.

## 최종 컬럼 순서 (progress 그룹 통합)

```text
… (identity/classification/content/location 등 기존) …
[ P.Start | A.Start | Start Status ]        ← Start 세트
[ P.Rectified | A.Rectified | Rectified Status ]  ← 기존 Completion 리네이밍
[ P.Closure | A.Closure | Closure Status ]  ← Closure 세트
[ Plan % | Actual % ]                       ← 진행률
… (audit/flags 등) …
```

## 변경 사항

### 1. `src/lib/defect-management/columns.ts`
- `DEFECT_COLUMNS` 재정렬: 위 순서대로 dates/status 컬럼을 `progress` 그룹으로 통합 이동
- 라벨 변경:
  - `planned_completion_date` "P.Completion" → **"P.Rectified"**
  - `actual_completion_date` "A.Completion" → **"A.Rectified"**
  - `completion_status` "Completion" → **"Rectified Status"**
  - `closure_status` "Closure" → **"Closure Status"**
  - `status_raw` "Status" 는 그대로 유지 (LetsBuild 원본 status)
- **신규 파생 컬럼 추가**: `start_status`
  - `type: "badge"`, `group: "progress"`, `editable: false`
  - DB 컬럼 아님 → parser/mutations에서 무시, 렌더링 시에만 계산
- `COMPLETION_STATUSES` 상수명은 유지 (코드 식별자), 옵션 라벨 표시만 그대로

### 2. `src/components/defect-management/raw-data/DefectRawDataPage.tsx` (렌더 파이프라인)
- 행 렌더 시점에 `start_status` 파생값 주입 헬퍼 추가:
  - `classifyStage(row, "start", asOf)` 결과 → `"Done" | "WIP" | "Planned" | "Delay" | "—"` 배지
  - `stage-utils.ts`의 기존 `classifyStage` 로직 재사용 (별도 export 필요 시 `DefectStageProgress.tsx`에서 export)
- 셀 렌더러가 `start_status` 키를 만나면 파생 배지 컴포넌트 사용, 정렬/필터는 파생값 기준

### 3. `src/components/defect-management/raw-data/DefectStageProgress.tsx`
- `classifyStage` 함수를 `export`로 노출 (파생 status 컬럼과 로직 공유)

### 4. 다국어/문구
- 상세 페이지(`DefectDetailPage.tsx`), Export 다이얼로그, Bulk Edit 등에서 "Completion" 사용자 표시 문구를 **"Rectified"**로 치환 (필드 키/변수/DB는 그대로)
- Progress 아이콘 legend/tooltip의 "Completion" → "Rectified"

## 유지 (변경 없음)
- DB 스키마, 컬럼명(`planned_completion_date`, `actual_completion_date`, `completion_status`), migration 불필요
- LetsBuild/Aconex 원본 헤더 매핑 (`defect_header_mappings` 값)
- `stage-utils.ts` 내부 함수명(`isActualComplete`, `isClosureComplete` 등 식별자)
- Bulk edit 옵션 값(`"Not Started" | "In Progress" | "Complete"`) — 저장값 호환성

## 기술 세부
- **파생 컬럼 정렬/필터**: `DefectRawDataPage`의 sort/filter가 `row[key]`를 직접 참조하므로, 행 매핑 시점에 `row.start_status = classifyStage(row, "start", asOf)`를 붙여 넣어 기존 파이프라인 무수정으로 동작
- **컬럼 순서 변경 영향**: 사용자별 컬럼 순서 저장(`user_view_preferences`)은 저장된 key 배열 기반이므로, 신규 사용자에게만 새 기본 순서 적용. 기존 저장 순서에 `start_status`가 없으면 기본 위치(P.Start 직후)에 자동 삽입되도록 `DefectColumnOrderMenu` 병합 로직 확인
- **Export**: XLSX export도 신규 라벨/파생값 반영 확인
- **tsgo 통과**: `bunx tsgo --noEmit`

## 리스크
- 컬럼 순서 저장한 기존 사용자는 새 세트 배치가 반영되지 않음(개인 설정 우선) — 재설정 UI 안내는 이번 스코프 밖
- `start_status`는 편집 불가(파생값). 사용자가 편집 시도 시 disabled 처리
