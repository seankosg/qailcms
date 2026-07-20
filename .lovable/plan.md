## 배경 및 원인

사용자가 "DMR Raw Data 일괄수정을 SMRD와 동일하게" 지시했음에도, 이전 턴에서 레퍼런스(SMRD) 파일을 실제로 열어보지 않고 추론으로 "하단 floating bar" 방향을 제안했습니다. 실제 SMRD는 **상단 sticky 카드**로, 정반대 배치였습니다. 재발 방지 규칙과 DMR 수정안을 하나의 계획으로 통합합니다.

---

## 파트 A. 재발 방지 프로토콜 (프로젝트 메모리 규칙)

`mem://index.md` Core 섹션에 아래 규칙 추가:

> "X와 동일하게/이식/포팅" 유형 지시는 반드시 레퍼런스 원본 파일을 tool로 열어 파일:라인 인용 + 현재 vs 레퍼런스 항목별 diff 표를 계획에 포함한 뒤 제출한다. 파일 존재만으로 "구현 완료"로 판정 금지. UI·배치·클래스·문구까지 지시 범위에 포함.

상세 규칙은 `mem://preferences/reference-first`에 저장(레퍼런스 우선 읽기 / Gap 표 필수 / 셀프 체크리스트).

---

## 파트 B. 레퍼런스 스냅샷 (SMRD 실측)

- `src/components/defect-management/raw-data/DefectRawDataPage.tsx:861-868` — 툴바 아래·테이블 위에 `<BulkEditBar />` 렌더.
- `src/components/defect-management/raw-data/BulkEditBar.tsx:145` — 래퍼 클래스:
  `sticky top-0 z-30 rounded-lg border border-l-2 border-l-primary bg-card px-3 py-2 shadow-sm`
- 내부 배치 순서: 선택 카운트(dot + "N selected" + 배치 안내) → 필드 Select → New value 입력 → (Set blank 체크) → Apply → Export 드롭다운(xlsx/TSV) → 더보기(영구삭제/Clear selection).

## 파트 C. 현재 DMR과의 Gap 표

| 항목 | SMRD (레퍼런스) | DMR 현재 | 조치 |
|---|---|---|---|
| 렌더 위치 | 툴바 아래·테이블 위 | 페이지네이션 아래(문서 흐름 최하단) | 툴바 아래·테이블 위로 이동 |
| 컨테이너 스타일 | `sticky top-0 z-30 …` 카드 | 일반 블록, sticky 없음 | 동일 클래스 적용 |
| 노출 조건 | 선택된 행이 있을 때 | 동일 | 유지 |
| 좌측 강조 | `border-l-2 border-l-primary` + 파란 dot | 없음 | 추가 |
| 카운트 문구 | "N selected · Will run in K batches of 500" | 다름 | 동일 문구로 통일 |
| Apply/Export/삭제 배치 | flex 한 줄, 우측에 Export·더보기 | 순서 상이 | SMRD와 동일 순서 |
| 필터 전체선택 버튼 | 상단 안내 우측 링크 | 있음(위치 상이) | SMRD와 동일 위치 |
| 체크박스 시인성 | 명확한 border | 흐릿함 | 클래스 보강 |

## 파트 D. 변경 파일 및 조치

1. `src/components/resource/dmr/DmrRawDataPage.tsx`
   - 599-607행의 `<DmrBulkEditBar />` 블록을 삭제.
   - 툴바(검색/필터/컬럼) 렌더 직후, 테이블 컨테이너 **바로 위**로 이동.
   - `__select` 컬럼 Checkbox에 `border-input` 등 시인성 클래스 보강.

2. `src/components/resource/dmr/DmrBulkEditBar.tsx`
   - 최상위 래퍼 클래스를 SMRD와 동일한 sticky 카드로 변경:
     `sticky top-0 z-30 rounded-lg border border-l-2 border-l-primary bg-card px-3 py-2 shadow-sm`
   - 내부 flex 배치를 SMRD 순서와 일치: 카운트 · 필드 Select · 값 입력 · Set blank · Apply · Export 드롭다운 · 더보기(삭제/Clear).
   - 카운트 문구를 "N selected · Will run in K batches of 500"으로 통일.

3. 기존 로직(선택 state, `bulkUpdateDmrEntries`, `bulkDeleteDmrEntries`, `exportDmrToXlsx`, `copyDmrAsTsv`, `selectAllFiltered`)은 그대로 재사용.

## 파트 E. 검증

- 빌드 통과 확인.
- Playwright로 `/resource/dmr/raw-data` 진입 → 헤더 체크박스 클릭 → 상단 sticky BulkEditBar 노출 확인 → 세로 스크롤 시 상단에 붙어 유지되는지 스크린샷 캡처.
- SMRD Raw Data 페이지 스크린샷과 나란히 비교하여 배치/클래스/문구 일치 확인.

## 셀프 체크리스트 (본 계획 제출 전)

- [x] SMRD 원본 파일을 tool로 실제 열람 (DefectRawDataPage.tsx:861, BulkEditBar.tsx:145)
- [x] 파일:라인 인용 포함
- [x] 항목별 diff 표 포함
- [x] "동일하게"를 기능만으로 축소해석하지 않음 (UI/배치/클래스/문구 포함)