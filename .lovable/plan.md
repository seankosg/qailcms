## 1. SHAW PROJECT CMS(SM) 분리 내보내기 로직 상세 검토

SHAW 원본(`src/lib/defect-excel-export.ts` L444~589) + 현재 QAIL의 SM 포팅본(`src/components/defect-management/raw-data/ExportDialog.tsx` L134~188)의 실제 동작을 파일:라인 기준으로 정리했습니다.

| 항목 | 동작 |
|---|---|
| 그룹 키 | `row.subcontractor_name`; 공백/`null` → `"Unassigned"` (ExportDialog L138) |
| 정렬 | 알파벳 오름차순, `Unassigned`는 맨 뒤 (defect-excel-export L473~477) |
| 파일 스타일 | 개별 파일마다 SHAW 스타일 헤더 블록을 재사용하되 `sourceSuffix = "Subcontractor: {name}"`로 6번째 메타 행에 그룹명 삽입 (ExportDialog L158/L179) |
| 파일명 | `defect-raw-{sanitize(key)}-{VIEW\|REIMPORT}-{doha timestamp}.xlsx`. `sanitize()`는 파일시스템 금지문자를 `_`로 치환하고 40자로 잘라냄 (L382) |
| 출력 임계값 | **그룹 수 ≥ 7 → JSZip 로 묶어 단일 `.zip` 다운로드** / 그 미만 → 파일별 순차 다운로드. 각 워크북 사이에 `setTimeout(0)`으로 이벤트 루프를 양보해 브라우저 다중 다운로드 차단을 회피 (L148/L165/L184) |
| 메모리 | 그룹 처리 후 `groups.set(key, [])`로 해당 배열을 즉시 해제하고, 단일 파일 경로는 `streamXlsxExport`의 페이지네이션 라이터를 재사용 (L143, L164, L183) |
| Format(view/reimport) | 그대로 유지 — 각 분리 파일도 동일한 format으로 생성 |

핵심 재사용 부품:
- `streamXlsxExport` (스트리밍 + 헤더/프리즈/셀 서식 통일)
- `buildStyledWorkbookBuffer` (ZIP 경로 전용, `writeBuffer()`로 바이너리 반환)
- `sanitize()`, `downloadBlob()` — 파일명 정화 및 blob 다운로드

## 2. TM에 이식할 계획

TM Raw Data 내보내기는 현재 단일 파일만 지원 (`src/components/task-management/raw-data/ExportDialog.tsx`). 여기에 SM 방식을 **동일한 UX/로직**으로 확장합니다.

### 2-1. UI 변경 (`ExportDialog.tsx`)

기존 Format 라디오 아래에 **Output** 라디오 그룹 추가 (SM ExportDialog L216~228 미러):

```text
Output
( ) 단일 파일
( ) Team 별 분리
( ) HDEC PIC 별 분리
( ) Plot 별 분리
```

한 번에 하나의 분할 축만 선택 (다중 축 조합은 이번 스코프에서 제외 — 필요 시 후속 요청으로 처리).

설명 문구: `그룹 수 ≥ 7 이면 자동으로 ZIP 으로 묶입니다.` (SM과 동일 임계값)

### 2-2. 분할 축 정의

| 옵션 | 그룹 키 (row 필드) | 파일명 라벨 | 빈 값 라벨 |
|---|---|---|---|
| Team 별 | `team` | `Team: {value}` | `Unassigned` |
| HDEC PIC 별 | `hdec_pic_name` | `HDEC PIC: {value}` | `Unassigned` |
| Plot 별 | `plot` | `Plot: {value}` | `Unassigned` |

컬럼 키 확인 완료: `src/lib/task-management/columns.ts` L134/L141/L211/L215.

### 2-3. 그룹핑 & 파일 생성 로직

SM `ExportDialog` L134~188 을 그대로 미러링:

1. `filteredRowsForExport`(현재 필터 결과 전체) 를 순회하여 `Map<string, Row[]>` 로 그룹화. 키 정규화는 `String(value).trim() || "Unassigned"`.
2. 정렬: 알파벳 오름차순, `Unassigned` 는 맨 뒤.
3. 각 그룹마다 SHAW 스타일 헤더(`title`, `metaRows`)의 5번째 메타 슬롯에 `Split: {축} = {키}` 를 삽입해 어느 축/값인지 파일 안에서도 식별 가능하게 함. TM 헤더 슬롯이 이미 5개이므로 그 중 마지막 빈 슬롯을 사용 (기존 필드는 유지).
4. 파일명 규칙:
   - 개별: `task-management_{format}_{axisTag}-{sanitize(key)}_{timestamp}.xlsx`
   - ZIP: `task-management_{format}_by-{axisTag}_{timestamp}.zip`
   - `axisTag` = `team` / `hdec-pic` / `plot`.
5. 임계값: 그룹 수 ≥ 7 → JSZip 로 묶어 단일 `.zip` 다운로드. 미만이면 파일별 순차 다운로드 + `setTimeout(0)` yield.
6. 각 그룹 처리 직후 `groups.set(key, [])` 로 배열 해제.
7. Format(view / reimport) 및 서식(Judgment fill, date numFmt 등) 은 기존 단일 파일 경로와 동일하게 유지 → 라이터 함수 하나만 파라미터화.

### 2-4. 라이터 재사용

TM 은 `streamXlsxExport` 만 사용 중이고 `buildStyledWorkbookBuffer` 유사 함수가 없음. 다음 중 하나를 선택:

- (A) `streamXlsxExport` 에 "buffer 반환" 모드(파일명 대신 Uint8Array) 를 추가하고 ZIP 경로는 이를 호출. `saveAs` 는 최상위에서만 실행.
- (B) SM `ExportDialog` 의 `buildStyledWorkbookBuffer` 를 `src/lib/excel/` 공용 파일로 승격하고 TM 에서도 동일 옵션(`cellFillFor`, `rowFillFor`, `numFmtByKey`)을 지원하도록 확장한 뒤 SM/TM 모두 이 공용 모듈을 사용.

권장은 (B) — SM 도 향후 동일 라이터로 통합되어 유지보수 표면이 줄어듬. 새 파일 후보: `src/lib/excel/styled-buffer.ts`.

### 2-5. 호출부 변경 (`TaskManagementRawDataPage.tsx`)

- Props 변화 없음(rows/visibleKeys 그대로). ExportDialog 내부에서만 축을 선택.
- 필터 요약 문자열(현재 화면의 team/hdec/plot 필터 값)을 헤더 metaRows 에 이미 포함하는지 확인 후 그대로 유지.

## 3. 스코프 밖 (질문 필요 시 알려주세요)

- 조합 분할(Team × Plot 등) — 현재는 단일 축.
- Task Summary(Tree) 페이지 및 Schedule Revision 페이지 내보내기 — 이번 계획은 Raw Data 만 대상.
- 서브태스크가 다른 축값을 가질 때 부모/자식이 서로 다른 파일에 나뉘는 문제 — SM 과 동일하게 "행 단위" 그룹핑이 기본. 유지가 맞는지 확인 필요할 수 있음.

## 4. 구현 순서

1. `src/lib/excel/styled-buffer.ts` 신설: 기존 SM `buildStyledWorkbookBuffer` 를 공용화하고 TM 옵션(`cellFillFor`, `rowFillFor`, `numFmtByKey`, `columnWidths`) 지원.
2. `src/components/defect-management/raw-data/ExportDialog.tsx` 를 신규 공용 라이터로 교체(동작 동일 유지, 회귀 없음 확인).
3. `src/components/task-management/raw-data/ExportDialog.tsx` 에 Output 라디오 및 분할 실행 경로 추가, ZIP 임계값 7 적용.
4. 파일명 규칙과 헤더 메타 슬롯 문구를 SM 과 동일한 톤으로 통일.
5. 수동 검증 시나리오: (a) 그룹 6개 → 파일 6개 순차 다운로드, (b) 그룹 7개 → 단일 ZIP, (c) `team`/`hdec_pic_name`/`plot` 이 빈 행이 `Unassigned` 로 묶임, (d) view/reimport format 두 축 모두 동작.
