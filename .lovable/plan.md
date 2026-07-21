# 임포트 로그 — 문제별 검토(Problem Review) 이식

## 배경

SHAW PROJECT CMS의 `DefectImportLogsPage`는 배치 상세에서 아래 기능으로 "문제별 검토"가 가능합니다 (src/pages/DefectImportLogsPage.tsx:365–526).

- 상단 요약 칩: `Total / inserted / updated / skipped / rejected` 카운트
- **Action 필터** 드롭다운 (all / inserted / updated / skipped / rejected)
- **Reason 필터** 드롭다운 — 배치 내 실제 발생한 `reason_code` 목록에서 동적으로 옵션 생성 (+ `(no reason)` 옵션)
- **Row #** 검색 인풋
- **Show 500 more** 방식 누적 렌더 (하드 컷 없음)
- (필드 로그가 있을 경우) 행 확장 → 필드별 outcome 표

QAIL CMS의 현재 `ImportLogsPage`(src/components/import/ImportLogsPage.tsx:545–599)는 SM/TM/ABD 모두 상세 화면이 단순 표 + 1000행 하드 컷이라 원인별 검토가 불가합니다. 반면 DB의 `*_import_row_logs` 3종 테이블은 이미 `action_taken / reason_code / reason_detail`을 저장하고 있어(확인 완료: `defect_import_row_logs`, `task_management_import_row_logs`, `abd_import_row_logs`) **UI만 이식하면 되는 상태**입니다.

## 목표

`ImportLogsPage`(공통 컴포넌트) 상세 뷰를 리팩터하여 SM/TM/ABD 3개 탭에 SHAW와 동등한 문제별 검토 UX를 제공합니다. Spare Part 탭도 동일 컴포넌트를 쓰므로 자동으로 함께 개선됩니다(사용자 요청 범위 외지만 부수 효과).

## 범위

### 대상
- `src/components/import/ImportLogsPage.tsx` 상세 카드 부분 (kind = `defect_management` | `task_management` | `abd` | `spare_part`)

### 비대상 (별도 확인 필요)
- SHAW의 필드 단위 로그(`import_field_logs` 테이블 + `FieldLogTable` 확장/축소)는 QAIL DB에 존재하지 않아 이식하려면 3개 모듈 임포트 파이프라인에 필드 로그 기록을 추가해야 합니다. 스코프가 커서 본 계획에서는 제외합니다.
- SHAW의 Schedule Changes(변경 감사) 탭 이식은 별개 이슈이며 이번 요청 범위 밖으로 판단합니다.

## 구현 세부 (기술)

### `ImportLogsPage.tsx` 상세 뷰 개편
현재 셀렉트된 배치 상세를 렌더링하는 라인 545~599 블록을 아래처럼 확장:

1. **상태 추가**
   ```ts
   const [actionFilter, setActionFilter] = useState<'all'|'inserted'|'updated'|'skipped'|'rejected'>('all');
   const [reasonFilter, setReasonFilter] = useState<string>('all'); // 'all' | '__none__' | <code>
   const [rowSearch, setRowSearch] = useState('');
   const [renderLimit, setRenderLimit] = useState(500);
   ```
   배치가 바뀔 때(`loadDetail`) 4개 상태를 초기화.

2. **집계 (useMemo)**
   - `actionCounts`: `rowLogs`에서 action별 카운트
   - `reasonOptions`: `rowLogs`의 `reason_code` distinct 정렬 목록
   - `filtered`: action / reason / rowSearch 필터 적용

3. **툴바 UI** (상세 카드 상단)
   - 좌측: `Badge` 5개 — Total {n} / inserted / updated / skipped / rejected (색상은 기존 `actionColor` 재사용)
   - 우측: `Select`(Action) · `Select`(Reason) · `Input`(Row #)
   - 필터 변경 시 `setRenderLimit(500)`으로 리셋

4. **행 렌더**
   - `filtered.slice(0, renderLimit)`
   - 하단에 `Showing X of Y (filtered from Z)` + `Show 500 more` 버튼
   - 기존 1000행 하드 컷 제거

5. **접근성/스타일**
   - SHAW와 동일하게 `TableHeader`에 `sticky top-0` + 스크롤 컨테이너 `max-h-[500px] overflow-auto`
   - `text-xs` 타이포 유지, 셔드시엔 컴포넌트 그대로 사용

### kind별 차이
- 4개 kind 모두 이미 `rowLogs`에 `action_taken/reason_code/reason_detail/raw_row_no/key_value`가 정규화되어 들어와 있어 **분기 없이 동일 UI**로 동작.
- SM 탭은 사용자가 명시한 3개 모듈 중 하나이며, TM/ABD도 동일 코드 경로로 이식 완료.
- Spare Part는 요청 밖이지만 같은 컴포넌트라 자동 개선(호환성 문제 없음).

### 라우팅/네비
- 라우트/탭 구조 변경 없음. 현재 `/import-log/logs?tab=snag|task|abd` 그대로 사용.

## 검증

1. Build 통과 (`tsgo`).
2. 각 탭(TM/SM/ABD)에서 배치 선택 → 상세 뷰에서:
   - Action 필터 변경 시 행 수 변화 확인
   - Reason 드롭다운에 실제 reason_code 목록이 뜨는지, `(no reason)` 선택 시 reason_code null 행만 남는지
   - Row # 입력 시 해당 행만 표시
   - 1000행 초과 배치에서 "Show 500 more" 누적 렌더 확인

## 확인 필요

계획을 확정하기 전에 한 가지만 확인 부탁드립니다.

- **필드 단위 로그(FieldLogTable — 어떤 필드가 어떤 이유로 skipped/derived되었는지)** 도 함께 이식이 필요할까요? 이 기능은 3개 모듈의 임포트 파이프라인에 필드 로그를 새로 기록하도록 파이프라인 개편이 필요해 별도 계획으로 분리하는 편이 안전합니다. 이번엔 **행 단위 문제별 검토(위 계획)** 만 진행하고, 필드 로그는 별도 요청으로 다루어도 될지 알려주세요.
