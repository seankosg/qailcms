# Import 파일 내부 중복(row) 미리보기 & 확인 UI 계획

현재는 파싱 결과에서 `source_issue_no` 중복 시 자동으로 마지막 행이 이전 행을 덮어쓰고 카운트만 로그에 남깁니다. 이번 개선은 **임포트 실행 전** 사용자가 중복 상황을 확인하고 처리 방식을 결정하게 만드는 것입니다.

## 동작 흐름

1. 파일 파싱 완료 → `source_issue_no` 기준으로 그룹핑.
2. **완전 동일 중복** (`raw_payload` JSON 문자열 동등) → 자동으로 하나만 남기고 조용히 dedupe (로그에만 반영).
3. **필드 차이가 있는 중복** → 파일 상태 `pending_duplicate_review` 로 지정, Start Import 버튼 비활성.
4. 파일 카드에 노란 알림 "중복 N그룹 검토 필요" + "중복 검토" 버튼 노출.
5. 다이얼로그에서 사용자 선택 후 확정하면 파일 상태 `ready` 로 승격, 실제 임포트 시 선택된 행만 사용.

## 다이얼로그 UI

- **상단**
  - 요약: "N개 그룹, 총 M개 중복 행 (K개 폐기 예정)".
  - 전략 라디오 3개:
    - **Keep last (기본 선택)** — 각 그룹의 마지막 행 유지 (기존 동작).
    - **Keep first** — 각 그룹의 첫 행 유지.
    - **Manual** — 그룹별로 개별 선택.
- **본문**
  - 그룹별 카드. 카드 헤더: `Issue No` + "N행 중 1개 선택".
  - 각 후보 행: 라디오 (전략이 manual 일 때만 활성, 아니면 disabled + 전략에 따라 자동 선택 표시), 주요 필드 미리보기(description, status_raw, updated_date_raw, created_date, updated_by_name, updated_status).
  - 전략 변경 시 그룹별 selectedIndex 자동 갱신 (keep_last → 마지막, keep_first → 첫 번째, manual → 사용자 값 유지).
- **하단**: "확인 (유지 K건, 폐기 L건)" / "취소".

## 데이터 구조

`DefectImportFile` 확장:
- `status`: `pending_duplicate_review` 추가.
- `duplicateStrategy?: 'keep_last' | 'keep_first' | 'manual'` (기본 `keep_last`).
- `duplicateGroups?: Array<{
    key: string;                    // source_issue_no
    rows: Array<{
      parsedIndex: number;          // parsed 배열 원본 index (sheet row 대체)
      preview: Record<string, unknown>;
    }>;
    selectedParsedIndex: number;    // 현재 유지될 행의 parsedIndex
  }>`
- `autoDedupedIdenticalCount?: number` — `raw_payload` 완전 동일로 자동 폐기된 건수.

## 완전 동일 판단

- 각 그룹 내부에서 `JSON.stringify(row.raw_payload)` 기준으로 그룹 나누기.
- 한 (issue_no, payload) 조합에 여러 행이 있으면 그중 마지막 하나만 살리고 나머지는 자동 폐기 (`autoDedupedIdenticalCount` 증가).
- 자동 dedupe 후에도 그룹에 후보 행이 2개 이상 남으면 → 사용자 검토 대상.
- 후보 행이 1개만 남으면 → 검토 불필요, 정상 진입.

## 파일 변경

- **수정** `src/contexts/DefectManagementImportContext.tsx`
  - 파싱 후 그룹핑 로직 + `duplicateGroups` 초기화.
  - 새 액션 `setFileDuplicateStrategy(id, strategy)` / `setFileDuplicateSelection(id, groupKey, parsedIndex)` / `resolveDuplicates(id)`.
  - `resolveDuplicates`: 각 그룹에서 `selectedParsedIndex` 만 남기고 나머지 parsed 행을 제거, 자동 dedupe 카운트와 합산해 최종 `duplicates` 산출, status 재계산(`needs_team` 또는 `ready`).
  - Start Import 진입 조건에 "미해결 duplicate group 없음" 추가.
  - 임포트 로그 `note` 에 `duplicate_strategy=<value>` 및 `duplicates_auto=X, duplicates_manual=Y` 기록.
- **신규** `src/components/defect-management/import/DuplicateReviewDialog.tsx`
  - Props: `file`, `open`, `onOpenChange`, `onChangeStrategy`, `onChangeSelection`, `onConfirm`.
  - 전략/그룹 UI 렌더링, 요약 카운트 계산.
- **수정** `src/components/defect-management/import/DefectManagementImportPage.tsx`
  - 상태 라벨 딕셔너리에 `pending_duplicate_review` (노란색) 추가.
  - 파일 카드에 미해결 시 배너 + "중복 검토" 버튼, 다이얼로그 마운트.
  - "Start Import" 활성 조건에 미해결 파일 없음 추가.

## 기본값/UX 규칙

- **기본 전략**: `keep_last` (기존 동작 100% 보존).
- **완전 동일 중복**: 자동 폐기, 사용자에게 카운트만 노출 (파일 카드에 "동일 중복 자동 제거: N건" 텍스트).
- **취소**: 파일 상태 유지 → Start Import 계속 잠금.
- **파일 단위 잠금**: 미해결 파일만 잠그고 다른 파일은 정상 진행 가능.
- **Re-import 모드**와는 독립 (DB 매칭은 이후 단계에서 별도 처리).

## 로그

- `DefectImportFile.result.duplicates` = 자동 폐기 + 수동 폐기 합계.
- import log `note`: `duplicate_strategy=keep_last`, `duplicates_auto=N`, `duplicates_manual=M`.
