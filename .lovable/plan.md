# ABD Raw Data Export — TM 동일 UI 이식

## 목표
ABD Raw Data의 Export 다이얼로그를 TM(`src/components/task-management/raw-data/ExportDialog.tsx`)과 동일한 UI/동작으로 재구축하고, 분리 축에 **HDEC ENG**와 **DIS**를 추가한다.

## 확정 사항 (사용자 답변)
- 내보내기 범위: **필터 결과 전체** — 서버에서 현재 필터/탭/검색 조건으로 재조회(청크 페칭) 후 내보내기
- Format: **View / Re-import 둘 다**
- 분리 축: **단일 파일 / Team / HDEC ENG / Plot / DIS**

## 현재 vs 레퍼런스 diff

| 항목 | TM (레퍼런스) | ABD (현재) | 조치 |
|---|---|---|---|
| Format 라디오 | View / Re-import (ExportDialog.tsx:274-290) | 없음 | 신설 |
| Output 분리 축 | 단일/Team/HDEC PIC/Plot (:291-318) | 없음 | 단일/Team/HDEC ENG/Plot/DIS |
| ZIP 자동 묶기 | 그룹 ≥ 7 → JSZip (:217-238) | 없음 | 동일 이식 |
| 헤더/메타 블록 | title + Exported/Rows/Columns + freeze (:169-179) | 없음 | 동일 이식 |
| 날짜/숫자 numFmt | NUMFMT_BY_KEY (:59-75) | 없음 | ABD 컬럼 기준으로 정의 |
| 상태 색상 | auto_judgment 셀 fill (:155-166) | 없음 | latest_status/current_stage 기준 적용 |
| 출력 엔진 | streamXlsxExport | `XLSX.writeFile` 단순 aoa (AbdExportDialog.tsx:27-30) | streamXlsxExport로 교체 |
| 대상 행 | 필터된 전체(메모리) | 현재 페이지 rows (AbdRawDataPage.tsx:901) | 서버 전량 재조회 |
| 파일명 | `CMS_TM_{format}_{axisTag}-{key}_{ts}.xlsx` | `abd-...-{ts}.xlsx` | `CMS_ABD_{format}_...` 규칙 통일 |

## 구현 범위

### 1. `src/lib/abd/export-fetch.ts` (신설)
- `fetchAllAbdRowsForExport(params)` — `useAbdItemsQuery`가 쓰는 `abd_items_search` RPC를 동일 파라미터(team/statusGroup/includeInactive/plot/q/filters/sort/asOf)로 호출하되 offset 0부터 1,000행 청크 루프로 전량 수집.
- `total_count` 대비 수집 행수 대조 후 불일치 시 예외(기존 `assertNoTruncation` 재사용).
- 진행률 콜백(`onProgress(loaded, total)`) 제공 → 다이얼로그 토스트에 표시.

### 2. `src/components/abd/raw-data/AbdExportDialog.tsx` (재작성)
- TM과 동일한 다이얼로그 구조: 제목, "현재 필터 결과 N행" 설명, Format 라디오, Output 라디오, ZIP 안내 문구, 취소/Export 버튼.
- View: 화면의 표시 컬럼·순서·사용자 라벨(`exportColumns`) 사용. Re-import: `ABD_COLUMNS` 전체 키를 snake_case 헤더로 출력.
- 분리 축 그룹핑: 값이 비면 `Unassigned`, 알파벳 정렬(Unassigned 최후), 그룹 ≥ 7 시 JSZip.
- `streamXlsxExport` 사용, 날짜 컬럼(`type==="date"`)은 `yyyy-mm-dd`, 숫자 컬럼 정렬 포맷 적용.

### 3. `src/components/abd/raw-data/AbdRawDataPage.tsx`
- `AbdExportDialog`에 `getRows` 대신 현재 쿼리 파라미터(team/statusGroup/filters/sort/q/plot/includeInactive/asOf), `total`, `exportColumns`(라벨·순서 반영)를 전달.

## 기술 메모
- 축 태그: `team` / `hdec-eng` / `plot` / `dis`. 파일명 `CMS_ABD_{format}_{axisTag}-{key}_{YYYYMMDD_HHmm}.xlsx`, ZIP은 `abd_{format}_by-{axisTag}_{ts}.zip`.
- 타임스탬프는 기존 `dohaStampCompact()`(Asia/Qatar) 유지.
- ABD는 서버 파생 컬럼(`completed_stage`, `current_stage`, `ur_aging_days` 등)을 RPC 결과에 이미 포함하므로 클라이언트 재계산 불필요(TM의 T.Actual 배치 조회에 해당하는 로직 없음).
- Raw Data 표의 컬럼 순서/라벨/필터 UI는 변경하지 않는다(내보내기 다이얼로그 한정).