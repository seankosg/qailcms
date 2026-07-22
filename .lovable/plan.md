## 목표
Defect(SM) 모듈의 `rectified_status` 컬럼에서 사용되던 **"Not Started"** 값을 **"Not finish yet"**으로 저장값·표시 라벨 모두 통일합니다. 기존 DB 행은 단일 마이그레이션으로 일괄 갱신합니다.

## 변경 계획

### 1) DB 마이그레이션 (1회성 일괄 UPDATE)
```sql
UPDATE public.defect_items_raw
SET rectified_status = 'Not finish yet'
WHERE rectified_status = 'Not Started';
```

### 2) 코드 수정
- `src/lib/defect-management/derived.ts`: `deriveRectifiedStatus`의 `"Not Started"` 반환값 4곳을 `"Not finish yet"`으로 교체. 주석 문구도 소폭 갱신.
- `src/lib/defect-management/columns.ts`:
  - `RECTIFIED_STATUSES = ["Not finish yet", "In Progress", "Rectified"]`
  - `DEFECT_STATUS_STYLES`의 `"Not Started"` 키를 `"Not finish yet"`으로 교체(기존 zinc 스타일 유지).

### 3) 유지 항목 (동일 문구지만 별개 개념)
- `stage-utils.ts`의 `classifyDefectStage` 반환 enum "Not Started" — Progress 가상 컬럼의 파생 스테이지 라벨로 `rectified_status`와 독립. 그대로 둡니다.
- `DefectRawDataPage.tsx`의 stage_progress 필터 옵션 "Not Started" — 위와 동일한 가상 컬럼용이므로 유지.
- `DefectStageProgress.tsx` — `rectified_status`를 `"wip"` 여부만 검사하므로 영향 없음.

### 4) 검증
- 타입체크 통과 확인.
- Raw Data 페이지 Rectified Status 필터 옵션·뱃지가 "Not finish yet"으로 표시되는지 확인.
- 마이그레이션 후 `SELECT DISTINCT rectified_status FROM defect_items_raw`에 "Not Started" 미존재 확인.

## 진행 순서
빌드 모드 전환 후 마이그레이션 승인 → 실행 → 위 2개 파일 수정 → 타입체크.
