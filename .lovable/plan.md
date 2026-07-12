## 원인 분석

화면의 `TypeError: Failed to fetch`는 Supabase가 반환한 에러가 아니라 **브라우저 fetch 자체가 네트워크 레벨에서 실패**한 것입니다. 콘솔 로그에서도 배치 52, 53, 54가 연속으로 `Failed to fetch`로 실패하는 패턴이 보이는데, 이는 다음 조합에서 발생합니다.

1. **배치 크기 과다** — `src/contexts/DefectManagementImportContext.tsx:97` 의 `INSERT_CHUNK = 500`. 27,123행 / 500 = 약 55 배치, 각 배치는 500행 × 74컬럼의 대용량 payload를 POST합니다.
2. **응답에 `.select("source_issue_no")` 포함** — upsert 결과로 500개 row를 매번 되돌려받아 응답 크기가 커집니다.
3. **연속 요청 시 Cloudflare/PostgREST 연결 재사용에서 abort 발생** — Supabase JS는 keep-alive 커넥션을 재사용하는데, 큰 payload를 55회 연속 던지면 중간에 커넥션이 리셋되며 브라우저 fetch가 `Failed to fetch`로 abort됩니다. `id-preview--...` 도메인은 특히 idle timeout이 짧습니다.
4. **폴백 재시도 로직이 상황을 악화** — 배치 하나 실패 시 500행을 **각각 개별 upsert**로 재시도하므로 실패한 배치당 500개 추가 요청이 발생, 네트워크 압박이 더 커집니다. 그래서 1,123 rejected(≈ 배치 2~3개 분량)이 발생.

즉 **파일이나 데이터 문제가 아니라 네트워크/전송 로직 문제**입니다.

## 수정 계획 (`src/contexts/DefectManagementImportContext.tsx` 만 수정)

1. **배치 크기 축소**: `INSERT_CHUNK` 500 → **150**. 27k행 기준 요청당 payload가 1/3로 감소.
2. **응답 payload 축소**: 배치 성공 시 반환값이 필요 없으므로 `.upsert(..., { onConflict, count: 'exact' })` 로 바꾸고 `.select()` 제거. inserted/updated 카운트는 이미 만들어 둔 `existing` 맵으로 계산(현재도 폴백 경로에서 그렇게 하고 있음).
3. **네트워크 실패 자동 재시도**: 배치 upsert가 `TypeError: Failed to fetch` 또는 `error.message`에 `Failed to fetch`/`NetworkError`/`fetch failed` 포함 시, **지수 백오프(300ms → 800ms → 2000ms)로 최대 3회 재시도**. 재시도 성공 시 정상 카운트, 3회 모두 실패해야 개별 row 폴백으로 이동.
4. **배치 간 짧은 지연**: 성공/실패 무관 각 배치 사이 60ms `await sleep`. 커넥션 압박 완화.
5. **개별 row 폴백에도 재시도 1회 추가**: 폴백에서도 `Failed to fetch` 시 500ms 후 1회 재시도.
6. 폴백 진입 시 UI 진행률이 멈추던 부분 유지, 로깅은 기존 `importErrors` 구조 그대로 사용.

## 변경 파일

- `src/contexts/DefectManagementImportContext.tsx` — 위 6개 항목만 수정. 다른 파일/UI/스키마는 변경 없음.

## 검증 시나리오

- 업로드한 `260711_MECH_Snagging_PLOT-C,D.xlsx` (27,123행) 재임포트 시 `Rejected` 가 0에 근접하고, 콘솔에 `Failed to fetch` 반복 로그가 사라지는지 확인.
- 소량 파일(수백 행)은 동작·성능 회귀 없이 그대로 성공하는지 확인.
- 의도적 오프라인 상황에서 3회 재시도 후 폴백으로 넘어가고, 최종 실패 row가 `defect_import_row_logs` 에 rejected로 기록되는지 확인.