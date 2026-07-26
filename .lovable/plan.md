# ABD 대시보드 ↔ Raw Data 정합성 개선 계획

## 1. 실측 검증 결과

Playwright로 SM/ABD 대시보드 카드 클릭 → Raw Data 이동 시 총합(뱃지) 비교.

### SM (정합)
- Dashboard(Plot C) **OPEN 24,179** → Raw Data 총합 **24,179**. 일치.
- 헤더 뱃지가 이미 `현재페이지 / 총계` 단일 형태(`1–100 / 24,179`)로 TM의 "매치/컨텍스트" 문제 없음.
- **결론: SM은 손대지 않음.**

### ABD (심각 — 딥링크 대부분 무효)
| 카드 | URL 파라미터 | Raw Data 총합 |
|---|---|---|
| Under Review | `status_group=under_review` | 2,606 (전체) |
| Response Delay | `status_group=rs_delay` | 2,606 (전체) |
| Draft Start Delay | `status_group=ds_delay` | 2,606 (전체) |
| No Plan | `status_group=no_plan` | 2,606 (전체) |

모든 카드가 동일한 MECH 전체 카운트를 표시 → **필터가 전혀 적용되지 않음**.

## 2. 근본 원인 (파일:라인 인용)

원인이 3중으로 겹쳐 있음.

**(A) URL 파라미터 key 불일치**
- `src/components/abd/dashboard/AbdKpiRows.tsx:171,175,246,248,261,263`: `status_group`으로 전달.
- `src/routes/_authenticated/closure/abd/raw-data.tsx:9`: 스키마는 `status`만 정의. `status_group`은 zod에서 버려짐.

**(B) 값 어휘 불일치**
- `src/components/abd/raw-data/AbdRawDataPage.tsx:162-167`의 `STATUS_TABS`는 `approved | in_progress | not_started` 3개만.
- Dashboard는 `approved | under_review | drafting | not_started | rs_delay | sb_delay | ds_delay | no_plan | delayed` 9개를 사용(DB `status_group` 컬럼 값).

**(C) RPC 타입 제약**
- `src/hooks/useAbdItems.ts:4`: `AbdStatusGroup = approved | in_progress | not_started | all`로 좁게 선언.
- `abd_items_search(_status_group)`는 단일 값 슬롯이며 위 3종 외에는 처리 불명확.

## 3. 개선 방식 (SM/TM와 동일: "카드 숫자 = 총합" 단일 원칙)

TM에서 도입한 원칙과 동일하게, **Dashboard 카드 값 = Raw Data 헤더 총합**을 보장.

### 변경 1: 딥링크 파라미터 통일 (`AbdKpiRows.tsx`)
- 모든 `onOpenRaw({ status_group: X, ... })` 호출을 `{ status: X, ... }`로 교체 (6곳).
- `AbdRow2Kpis`의 `delayed` 카드도 `status=delayed`로 전달.

### 변경 2: Raw Data가 전체 `status_group` 어휘 수용 (`AbdRawDataPage.tsx`)
- `STATUS_TABS`를 확장하지 않고(=UI 탭은 기존 3개 유지), **`ALL_STATUS_VALUES`만 확장**하여 URL 파라미터로 들어오는 9개 값을 모두 유효값으로 인정.
- `selectedStatuses` → `status_group in [...]` 서버 필터 push 조건을 **`>=1` 선택 시**로 변경(현재는 `>=2`부터만 push).
- `statusGroup`(RPC 단일 슬롯)에는 `approved|in_progress|not_started` 3종만 매핑, 그 외 값은 항상 `all`로 두고 서버 필터로 좁힘 → 카운트/데이터 모두 정합.

### 변경 3: `AbdStatusGroup` 타입 완화 (`useAbdItems.ts`)
- 타입만 문자열 union 확장. RPC 인자 자체는 그대로. Raw Data 컴포넌트 내부에서 위 매핑으로 안전 처리.

### 변경 4: 헤더 뱃지 표기 확인
- ABD Raw Data 헤더는 이미 `1–100 / 2,606` 단일 총계 표기 → SM/TM과 동일 원칙. **추가 개편 불필요.**

## 4. 변경 대상 파일 (총 3개)

| 파일 | 변경 내용 |
|---|---|
| `src/components/abd/dashboard/AbdKpiRows.tsx` | `status_group` → `status` 파라미터 rename (6곳) |
| `src/components/abd/raw-data/AbdRawDataPage.tsx` | `ALL_STATUS_VALUES` 9종 확장, 서버 필터 push 조건 완화, `statusGroup` 안전 매핑 |
| `src/hooks/useAbdItems.ts` | `AbdStatusGroup` 타입 union 확장 |

**손대지 않음**: SM 모듈 전반, ABD RPC(`abd_items_search`), 라우트 스키마(이미 `status` 이름 사용).

## 5. 검증 체크리스트

`/tmp/browser/consistency/check2.py`에 카드 4종을 추가하여 실측:
- [ ] Under Review 카드 값 = Raw Data 총합
- [ ] Response Delay 카드 값 = Raw Data 총합
- [ ] Draft Start Delay 카드 값 = Raw Data 총합
- [ ] No Plan 카드 값 = Raw Data 총합
- [ ] Approved 카드 값 = Raw Data 총합(회귀 확인)
- [ ] 다중 카드 조합/팀 변경 시에도 유지

승인 시 위 3개 파일만 순서대로 수정하고 Playwright로 실측 결과를 첨부하겠습니다.
