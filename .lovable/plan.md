# Snag 임포트 속도 최적화 계획

현재 임포트 파이프라인이 느린 원인은 **분류가 필요 없는 행/필드까지 규칙·LLM을 통과**하고, LLM 배치가 **순차 30건**으로 처리되기 때문입니다. 이를 "빈 셀 사전감지 게이트" + "LLM 배치 튜닝" + "가시성" 3축으로 개선합니다.

## 1. 빈 셀 사전감지 게이트 (핵심)

`src/contexts/DefectManagementImportContext.tsx` 분류 단계 앞에 게이트 추가:

```text
파싱 → base 조립 → [게이트] targets 계산 → 규칙(only=targets) → [남은 필드 有?] → LLM(대상 필드만) → 병합 → upsert
```

- 행별 `targets: ClassifierField[]` 를 base 조립 직후 한 번만 계산
  - 판정: 파싱된 원본 필드값과 DB `existing` 값이 **모두** null/빈/`To Be Confirmed` 인 컬럼만 포함
  - `targets.length === 0` → 분류 파이프라인 **전면 스킵** (규칙·LLM 모두 미실행)
- `classifyByRules(input, targets)` 호출로 규칙도 대상 필드만 매칭 (기존 `only` 인자 활용 — 현재 임포트 경로에서 전달 누락되어 있는지 확인 후 전달)
- 각 행별로 규칙이 채운 필드를 제외한 나머지만 `llmTargets` 로 남기고, `llmTargets.length > 0` 인 행만 LLM 큐 적재
- LLM 프롬프트에도 `targets` 필드만 스키마에 포함해 토큰·응답 크기 절감

## 2. LLM 배치 튜닝

`src/lib/defect-management/classifier/llm-classify.functions.ts` + Import 컨텍스트 호출부:

- 배치 크기 **30 → 50** (gemini-2.5-flash-lite 안정 범위)
- 임포트 경로 배치 처리를 **병렬 3** 으로 변경 (현재 순차). `bulk-classify.functions.ts`와 동일한 워커풀 패턴 재사용
- 실패 배치는 개별 재시도 없이 `To Be Confirmed` 처리 (기존 정책 유지)

## 3. Raw Data 재분류 동일 최적화

`src/lib/defect-management/classifier/bulk-classify.functions.ts`:

- `computeTargets` 는 이미 사용 중이므로 로직 유지
- 배치 크기 30 → 50 통일
- 규칙 매칭만으로 완결된 행은 LLM 큐에 넣지 않는 현행 로직 유지·검증

## 4. 진행 UI 가시성

`DefectManagementImportContext` 진행 상태에 카운터 추가:

- `분류 스킵 n건 (이미 값 있음)` / `규칙 매칭 n건` / `LLM 처리 n건` / `실패 n건`
- 완료 토스트에 동일 요약 노출 → 이후 규칙 사전 튜닝의 근거 데이터로 활용

## 5. 변경 파일

- 수정: `src/contexts/DefectManagementImportContext.tsx` — 게이트 삽입, `targets` 전달, LLM 병렬화, 카운터
- 수정: `src/lib/defect-management/classifier/llm-classify.functions.ts` — 배치 크기 상수, 대상 필드만 스키마화
- 수정: `src/lib/defect-management/classifier/bulk-classify.functions.ts` — 배치 크기 상수 통일
- 수정 없음: `rule-classify.ts` (이미 `only` 지원), `apply-classification.ts`, `rules.ts`, DB 스키마, parser, columns

## 6. 기대 효과

- 원본 엑셀에 4개 필드가 이미 채워진 대량 임포트: **분류 파이프라인 전체 스킵** → 사실상 이전(분류 도입 전) 속도로 회귀
- Defect Location만 비어있는 전형적 케이스: 규칙 매칭 커버리지가 높아 LLM 호출 대폭 감소, 남은 LLM 호출도 병렬 3·배치 50으로 처리 시간 5~10배 단축 예상
- LLM 크레딧 소모도 동일 비율로 감소

## 7. 비기능

- 계층 검증(`isSubTradeInMain` 등)·`To Be Confirmed` 정책·권한 체크는 모두 그대로 유지
- 이미 값 있는 필드는 **절대 덮어쓰지 않음** 원칙 유지 (마크다운 0.1·5.1)
- 실패는 임포트 자체를 중단하지 않고 로그·토스트로 노출
