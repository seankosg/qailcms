## 목표

각 모듈(ABD / SM / TM / DMR / Spare Part) 임포트 화면에서 **다른 모듈의 원본 파일이 잘못 업로드되는 상황을 사전 차단**한다. 파일 선택 직후 원본 Excel 헤더 문자열만 검사하는 단일 게이트로 처리한다. 컬럼 선택 대화상자나 저장 직전 로직은 건드리지 않는다 — 앵커 필드의 잠금/업데이트 여부는 이 기능의 관심사가 아니라 기존 유니크 키 정책이 담당한다.

## 단일 게이트 — 파일 헤더 지문 판정

파일 선택 시 시트의 헤더 행만 뽑아 아래 순서로 판정한다. 파싱·컬럼 선택 대화상자는 통과 후에만 열린다.

### A. 앵커 헤더 유무 — 하드 블록

각 모듈이 지정한 앵커 헤더가 파일에 **하나도 없으면 즉시 차단**. 대소문자/공백/구두점은 정규화 후 비교.

### B. 교차 지문 유사도 — 오탐 방지

- 5개 모듈의 지문 세트(각 8~12개)와 파일 헤더의 자카드 유사도 산출.
- Top 모듈 ≠ 현재 임포트 화면 & 차이 ≥ 20% → 하드 블록 + 감지 모듈 딥링크.
- 차이 < 20% (모호) → 노랑 경고 + "그래도 진행" 체크박스 확인 시 진행.

### C. 파일명/시트명 시그니처 — 신뢰도 가산점

강제 아님. 파일명 정규식·시트명이 매칭되면 B의 유사도에 소폭 가산.

### 모듈별 앵커/지문(초안)

| 모듈 | 앵커(하나 이상 필수) | 추가 지문 헤더(유사도 산정용) |
|---|---|---|
| ABD | Document No, Rev, Round, Draft, Submission, DAR Response, Latest Status | Discipline, Package, Revision Date |
| SM | Issue No / Source Issue No, Location, Punch Category, Raised Date | Status, Assign To, Closed Date, Root Cause |
| TM | Task No, Main Task No, Sub Task, Plan Start, Plan Finish, Actual Progress | Discipline, Plan Days, Forecast End, Data Date |
| DMR | Date, Team (공종), Sub Contractor (계약자), Direct, Indirect, TOTAL | Plot, Trade, Remark |
| Spare Part | Part No, System, Sub Contractor, Q'ty, Status | Description, Doc Ref, Manufacturer |

한글 별칭(`공종`, `계약자`, `계획완료일` 등)도 각 모듈 지문에 함께 포함해 다국어 헤더 파일 대응.

## 사용자 경험 — 임포트 화면 상단 배너

- **정상 (초록)**: `Detected: TM ✓` + 앵커 히트 수 표시. 이후 파싱·컬럼 선택 흐름 정상 진행.
- **모호 (노랑)**: `Detected: TM (low confidence)` + 2등 모듈 유사도. 사용자가 "그래도 진행" 체크해야 대화상자 오픈.
- **차단 (빨강)**: `This file looks like ABD` + `Go to ABD Import` 딥링크. 임포트 버튼 비활성, 이후 UI 렌더링 안 함.

## 구현 범위

### 신규

- `src/lib/import/module-fingerprint.ts`
  - `MODULE_FINGERPRINTS: Record<ModuleId, { anchors, signature, filenamePattern?, sheetHints? }>`
  - `detectModule(headers, sheetNames?, filename?): { top, scores, anchorsHit, confidenceGap }`
  - `evaluateImport(target, headers, sheetNames?, filename?): { verdict: "ok"|"ambiguous"|"block", detected, reason, hint? }`
- `src/components/import/ModuleGuardBanner.tsx` — 3상태 배너 + 감지 모듈 딥링크 + "그래도 진행" 체크박스.

### 수정 — 각 임포트 페이지에 배너 삽입

- `src/components/abd/import/AbdImportPage.tsx`
- `src/components/defect-management/import/DefectManagementImportPage.tsx`
- `src/components/task-management/import/TaskManagementImportPage.tsx`
- `src/components/spare-part/import/SparePartImportPage.tsx`
- `src/components/resource/dmr/DmrImportPage.tsx`

각 화면에서 파일 헤더 추출 직후 `evaluateImport` 호출:
- `verdict === "block"` → 배너만 렌더, 파싱/대화상자 호출 금지.
- `verdict === "ambiguous"` → 노랑 배너 + 체크박스, 체크되기 전까지 진행 버튼 비활성.
- `verdict === "ok"` → 초록 배지 표시하고 기존 흐름 그대로 계속.

## 기술 노트

- 헤더 정규화: `toLowerCase().replace(/[\s_\-().]/g, "")`.
- 앵커/지문은 정규화된 문자열로 저장·비교.
- 자카드 유사도 = `|A ∩ B| / |A ∪ B|`. `confidenceGap = topScore − runnerUpScore`.
- 순수 클라이언트 함수(네트워크 없음). SSR 이슈 없음.
- DB 마이그레이션·라이브러리 추가 없음.
- 기존 컬럼 선택 잠금 정책, 유니크 키 매칭 로직은 **변경하지 않음**.

## 검증 방법

1. **정상 파일**: 초록 배지 노출, 기존 컬럼 선택 → 파싱 → 저장 흐름 그대로 동작.
2. **다른 모듈 파일**: 빨강 배너 + 딥링크, 컬럼 선택 대화상자와 파싱이 시작되지 않음.
3. **헤더가 일부 겹치는 파일**: 노랑 경고, "그래도 진행" 체크 후에만 이어짐.
4. **한글 헤더 파일**(`공종`, `계약자` 등): DMR/TM 로 정상 감지.
