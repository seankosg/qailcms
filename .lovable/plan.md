# Snag 하자 자동 분류 엔진 반영 계획

첨부 마크다운(`Snag_Trade_Classification_Prompt.md`)의 규칙을 Snag 임포트/Raw Data 파이프라인에 반영합니다. **하이브리드(규칙+LLM)** 방식, **컬럼 단위 빈 값만 계산**, **임포트 자동 실행 + Raw Data 수동 재실행** 두 경로 모두 지원.

## 1. 대상 컬럼 및 계층

4개 대상 필드 (DB `defect_items_raw`):
- `defect_location` (신규, 지난 턴에 추가 완료)
- `main_trade`, `sub_trade`, `work_type` (기존 컬럼, 현재는 re-import 시에만 채워짐)

계층 정합성:

```text
Team ⊃ Category ⊃ Main Trade ⊃ Sub Trade   (엄격 4단계)
Defect Location, Work Type                  (독립 2축)
```

Category → Team 매핑은 이미 `defect_category_team_map` 테이블로 관리 중 → 재사용. Main/Sub Trade 계층은 마크다운의 1.1~1.4 표를 코드 상수로 이식.

## 2. 아키텍처 (하이브리드)

새 모듈 `src/lib/defect-management/classifier/`:

- `rules.ts` — 마크다운 표를 그대로 옮긴 키워드 사전 및 계층 정의
  - `TRADE_FAMILIES`: Category → family(Electrical/Mechanical/Facade/Architectural)
  - `TRADE_RULES[family]`: `[keywords, mainTrade, subTrade]` 순서 배열
  - `LOCATION_RULES`, `WORK_TYPE_RULES`
- `rule-classify.ts` — `classifyByRules({ type, item, description, category }) → { defect_location?, main_trade?, sub_trade?, work_type? }`
  - Type → Item → Description 순으로 키워드 매칭
  - 매칭 실패 시 undefined (LLM 폴백 대상). 마크다운 규정상 최종 "판별 불가"는 `To Be Confirmed` 문자열.
- `llm-classify.functions.ts` (server function, `createServerFn` + `requireSupabaseAuth`)
  - 규칙으로 채우지 못한 필드가 있는 항목만 배치로 LLM에 위임
  - Lovable AI Gateway + AI SDK, `google/gemini-2.5-flash-lite` (대량·저비용 분류)
  - `Output.object` 구조화 출력: `{ items: [{ id, defect_location?, main_trade?, sub_trade?, work_type? }] }` — 스키마 필드는 `.nullable()`, 프롬프트에 판별 불가 시 `To Be Confirmed` 지시
  - 배치 크기 30~50, 실패 시 개별 재시도 없이 `To Be Confirmed` 처리 후 진행
- `apply-classification.ts` — 규칙+LLM 결과 결합, 계층 검증(Sub∈Main∈Family), 위반 값은 폐기

## 3. "빈 값" 판정 (증분 처리)

각 4개 컬럼을 독립적으로 판별. 계산 대상 조건:
- 임포트 경로: 파싱된 원본 행에서 `p.<field>`가 null/빈 문자열 **그리고** DB 기존 행의 `<field>` 도 null/빈 문자열/`"To Be Confirmed"`
- Raw Data 수동 재실행: DB 행의 `<field>` 가 null/빈 문자열/`"To Be Confirmed"` 인 컬럼만
- 이미 값이 있으면 절대 덮어쓰지 않음 (마크다운 0.1·5.1 엄수)

## 4. 임포트 자동 실행 통합

`src/contexts/DefectManagementImportContext.tsx`의 upsert 파이프라인 중간에 자동 분류 단계 삽입:

1. 기존: 파싱 → dedup → base 행 조립 → upsert
2. 신규 삽입 지점: base 행 조립 직후, upsert 직전
   - 각 행마다 4개 필드의 "빈 여부" 계산 (DB 기존값도 이미 `existing` Map으로 조회 중)
   - 빈 필드가 하나라도 있는 행만 분류 큐에 적재
   - `classifyByRules` 로 규칙 채움 → 남은 빈 필드 있는 행은 LLM 서버 fn 호출
   - 결과를 `put(base, field, value)` 로 병합 (계층 검증 통과분만)
3. 진행 상황을 기존 임포트 진행 UI에 "AI 분류 중 (n/총)" 로 표시
4. LLM 실패해도 임포트 자체는 계속 (실패 필드는 `To Be Confirmed` 로 채움)

## 5. Raw Data 수동 재실행

- `src/components/defect-management/raw-data/DefectRawDataPage.tsx` 툴바에 신규 버튼 `AI 하자 분류` (admin/superuser만 노출)
- 현재 필터/선택 상태 기반:
  - 선택 행이 있으면 그 행들만
  - 없으면 현재 필터 조건 전체 (확인 다이얼로그 필수, 최대 5,000행 캡)
- 서버 함수 `classifyDefectsBulk` (`createServerFn`, `requireSupabaseAuth` + admin 체크):
  - 입력: `{ ids: string[] }` 또는 `{ filter: {...} }`
  - 대상 행을 DB에서 로드 (`type`, `item`, `description`, `category` + 현재 4개 필드값 + `defect_type`/`priority_locked` 등 필요한 최소 컬럼)
  - 규칙+LLM 분류 (동일 로직 재사용)
  - 빈 필드만 UPDATE, 결과 통계 반환 `{ processed, filled: { field: count }, failed }`
  - 완료 후 진행 토스트, TanStack Query invalidate

## 6. UI/UX 세부

- 임포트 진행 스텝 라벨에 "AI 분류" 추가 (기존 "저장 중" 앞)
- Raw Data 툴바 버튼: 확인 다이얼로그에 대상 행 수 + 예상 크레딧 소비(대략치) 표시, `Confirm` 후 실행
- 결과 토스트: `n건 분류: Defect Location m, Main Trade m, Sub Trade m, Work Type m 채움`
- `To Be Confirmed` 값도 컬럼에 실제로 저장 → 사용자가 필터로 골라 수동 편집 가능
  - `columns.ts`의 `main_trade`/`sub_trade`/`work_type`/`defect_location` 은 이미 editable text 이므로 편집 UX 그대로 사용

## 7. 계층 검증

`main_trade`가 후보로 나왔을 때 그 값이 해당 행의 `category` family 아래인지 검증. `sub_trade` 는 채택된 `main_trade` 하위인지 검증. 위반 시 해당 필드 폐기(설정하지 않음). LLM은 프롬프트에 계층 표를 명시하되, 코드에서 최종 검증하여 위반값은 무시.

## 8. 파일 변경 요약

- 신규: `src/lib/defect-management/classifier/rules.ts`
- 신규: `src/lib/defect-management/classifier/rule-classify.ts`
- 신규: `src/lib/defect-management/classifier/apply-classification.ts`
- 신규: `src/lib/defect-management/classifier/llm-classify.functions.ts` (서버 fn)
- 신규 or 재사용: `src/lib/ai-gateway.server.ts` (Lovable AI Gateway helper — 없으면 신규)
- 수정: `src/contexts/DefectManagementImportContext.tsx` (자동 분류 단계 삽입, 진행 표시)
- 수정: `src/components/defect-management/raw-data/DefectRawDataPage.tsx` (툴바 버튼)
- 수정 없음: parser, columns, DB 스키마 (모두 이전 턴/기존 상태 활용)

## 9. 비기능

- **모델**: `google/gemini-2.5-flash-lite` (분류·대량·저비용). 크레딧 부족(402)·레이트리밋(429) 시 사용자 토스트로 명시.
- **비용 관리**: 규칙으로 대다수 채움 → LLM은 폴백에만. 배치 30~50건/요청.
- **동시성**: 임포트 파이프라인은 순차, Raw Data 재실행은 최대 5,000행 캡, 배치 병렬 3 이하.
- **보안**: 서버 fn 모두 `requireSupabaseAuth`, Raw Data 재실행은 admin/superuser 체크.
- **로그**: 실패 배치는 콘솔 warn + 임포트 로그 warnings 배열에 기록.

## 10. 후속(계획 외)

- Main/Sub Trade 계층을 관리자 페이지에서 편집 가능하도록 하는 UI는 이 계획에서 제외 (현재는 코드 상수). 필요 시 별도 요청.
- Warranty 등 향후 확장 모듈에 동일 분류기를 재사용할 수 있게 `classifier/` 는 defect 전용이 아닌 범용 구조로 확장 가능하도록 설계.
