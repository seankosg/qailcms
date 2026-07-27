## 문제 요약
캡처의 "편집 0"은 실제 편집이 없었던 게 아니라 **`changed_by`가 항상 NULL**로 들어가서 사용자 매핑이 깨진 결과입니다.

- `task_management_status_history` 에 `source='manual'` 행이 지난 30일간 **82,538건** 실존.
- 그러나 모든 행의 `changed_by`가 NULL → RPC `tm_edit_record_daily`가 `changed_by IS NOT NULL` 필터에서 전부 탈락 → UI 0.
- 원인: 트리거 `trg_task_history`가 `current_setting('app.change_user')`만 읽는데 브라우저 UPDATE 어느 경로도 이 GUC를 세팅하지 않음.

## 수정 계획

### 1) DB 마이그레이션 — 트리거 함수 보강
`trg_task_history` 함수에 `auth.uid()` 폴백 추가.
```
uid := nullif(current_setting('app.change_user', true), '')::uuid;
if uid is null and src <> 'import' then
  uid := auth.uid();
end if;
```
- import 경로(`app.change_source='import'`)는 폴백 미적용 → 오탐 없음.
- 이후 모든 UI 편집은 `changed_by`가 자동으로 채워짐.
- 과거 82,538건은 원천에 사용자 정보가 없어 **소급 복원 불가**.

### 2) RPC 단순화 — `tm_edit_record_daily`
반환 컬럼을 `edits_count/tasks_count` 대신 **존재 여부만** 반환.
```
RETURN QUERY
SELECT h.changed_by AS user_id,
       ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) AS date_key
FROM public.task_management_status_history h
WHERE h.source='manual'
  AND h.changed_by IS NOT NULL
  AND ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) BETWEEN p_from AND p_to
GROUP BY 1,2;
```

### 3) 프론트 — `TmImportRecordTab.tsx`
- `editMap`을 `Map<"userId|dateKey", true>` (Set 형태)로 단순화.
- 매트릭스 셀 렌더:
  - **업로드 유/무**: 위쪽 ✓/✗ (기존)
  - **편집 유/무**: 아래쪽 ✓/✗ (색만 구분, 예: 편집 있음 sky-600, 없음 slate-300)
  - 숫자(E/T) 표시 제거.
  - tooltip: `업로드 O/X · 편집 O/X`
- 팀 헤더 뱃지의 "오늘 편집 N명"은 유지(사람 수 카운트).
- 사용자 행 우측 합계: "업로드 N/30 · 편집 M/30".

### 4) Excel 내보내기 — `exportTmImportRecord.ts`
- 셀 표기: `"U/E"`, `"U/-"`, `"-/E"`, `"-/-"` 4가지 조합의 단일 문자열.
- `editMap` 시그니처는 `Set<string>`로 변경.

### 5) 검증
- 마이그레이션 승인 → 임의 Task 편집 → DB SELECT로 `changed_by` 채워짐 확인 → 매트릭스 오늘 열의 편집 ✓ 표시 확인.

## 영향 범위
- DB: 함수 2개(`trg_task_history`, `tm_edit_record_daily`) 재정의.
- 코드: `TmImportRecordTab.tsx`, `exportTmImportRecord.ts` 2개 파일.
- 다른 모듈(ABD/SM/DMR) 영향 없음.
