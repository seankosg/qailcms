# Raw Data 툴바 버튼 통일

## 통일 규칙 (좌 → 우)

검색창(있는 경우)은 툴바 좌측 유지. 우측 액션 그룹은 아래 순서 고정:

```text
[Columns] → [모듈 전용] → [Reset] → [Import] → [Export] → [추가 액션]
```

- **Refresh 버튼 전면 삭제** (5개 모듈 모두)
- **Export는 검정색 primary 스타일 통일** (`<Button size="sm">` = default variant, `<Download>` 아이콘)
- **Import 스타일 통일**: `variant="outline" size="sm"` + `<Upload>` 아이콘
- **버튼 세트 자체는 그대로 유지** — 추가/삭제 없이 순서만 재배치 (+ Refresh 제거)

## 모듈별 최종 배치

| 모듈 | 최종 버튼 순서 |
|---|---|
| **ABD** | Columns → Export → Import  ⇒ **Columns → Import → Export** (Refresh 삭제) |
| **SM (Snag)** | Import → AiClassify → Columns → Export → Unclosed XLSX ⇒ **Columns → AiClassify(모듈전용) → Import → Export → Unclosed XLSX** |
| **TM (Task)** | Columns → Expand/Collapse → CriticalThreshold → Import → Export → Task 추가 ⇒ **Columns → Expand/Collapse → CriticalThreshold(모듈전용) → Import → Export → Task 추가** (변경 최소, 순서 확인) |
| **SP (Spare Part)** | Columns → Reset → Refresh → Import → Export ⇒ **Columns → Reset → Import → Export** (Refresh 삭제) |
| **DMR** | Export → Columns → Import ⇒ **Columns → Import → Export** |

## 기술 세부

수정 파일 5개:

- `src/components/abd/raw-data/AbdRawDataPage.tsx` (L481–501)
- `src/components/defect-management/raw-data/DefectRawDataPage.tsx` (L788–812 영역, Export를 `variant="default"` 유지)
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (L1173–1221)
- `src/components/spare-part/raw-data/SparePartRawDataPage.tsx` (L490–518, Refresh 블록 삭제)
- `src/components/resource/dmr/DmrRawDataPage.tsx` (L457–475, Export를 default variant로 변경)

Refresh 삭제로 인해 미사용이 되는 `RefreshCcw` import는 각 파일에서 함께 정리. Refresh에 연결됐던 `invalidate()`/`refetch()`는 필터·페이지 변경 시 자동 재조회 로직이 이미 있으므로 UI만 제거하고 훅은 유지.

## 검증

- `tsgo`로 타입 확인
- 각 페이지 preview에서 툴바 스크린샷 (5개) — 버튼 순서·스타일 일관성 육안 확인
