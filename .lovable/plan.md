# Defect Import 속도 개선

## 원인 분석 (`src/contexts/DefectManagementImportContext.tsx`)

현재 executeImport는 파일당 순차적으로 다음을 수행합니다.

1. **작은 배치 + 인위적 지연**: `INSERT_CHUNK = 150`, 배치 사이 `BATCH_DELAY_MS = 60` sleep. N행이면 `ceil(N/150)` 번의 네트워크 왕복 + 매번 60ms 대기.
2. **완전 직렬 upsert**: 배치를 하나씩 await. Supabase REST 왕복(TLS+지역 RTT)이 200~400ms이면 이게 총 시간의 대부분.
3. **existing 조회도 500개씩 직렬** (`select ... in(...)`): 1만행이면 20회 직렬 왕복.
4. **per-row logs 직렬 500개 단위 insert**: 데이터행 수만큼 다시 insert 왕복이 반복.
5. **매 배치마다 `setFiles(...)` 진행률 업데이트**: React 리렌더가 매 배치 발생 → UI 스레드 부하 (대량 파일 카드가 있으면 체감 지연).
6. **에러 발생 시 fallback이 한 행씩 개별 upsert**: 한 배치에 오류 1건이면 150회 개별 왕복으로 폭발적으로 느려짐. 로그에서 확인된 `defect_items_raw_team_check` 제약 위반이 실제로 이 경로를 트리거 중.
7. **`return=representation` 응답**: supabase-js는 `.select()` 없이 upsert하면 대부분 minimal 반환이지만, 일부 환경에서 여전히 대량 응답이 옴. 명시 옵션이 없음.
8. **raw_payload 크기**: 각 행에 원본 JSON을 통째로 저장 → 배치 페이로드가 큼. 배치를 크게 하면 요청 크기가 문제될 수 있어 균형 필요.

## 개선안 (코드 변경 위주, DB 스키마 변경 없음)

### A. 배치·동시성 튜닝 (효과 최상, 리스크 낮음)

- `INSERT_CHUNK`를 **500**으로 상향 (payload 크기가 커도 raw_payload 포함 500행 ≈ 수백 KB로 안전 범위).
- `BATCH_DELAY_MS`를 **0**으로 (또는 완전 제거).
- 배치 upsert를 **동시성 4**로 병렬 실행 (간단한 p-limit 패턴). Supabase는 병렬 요청을 무리 없이 소화하며, PostgREST connection pool도 여유가 있음.
- 예상: 이 3가지만으로 대형 파일 임포트 시간 **60~80% 단축**.

### B. existing 조회 병렬화

- ids를 500개씩 나눠 `Promise.all`로 병렬 조회. 왕복 수 그대로지만 총 소요시간 병렬화로 대폭 감소.

### C. per-row logs 최적화

- `defect_import_row_logs` insert를 병렬화 (동시성 4).
- 더 나아가 **진행률 100% 도달 후 백그라운드**에서 처리하고 사용자에게 "완료" 표시 (지연 없이 다음 파일로 진행). 실패 시 콘솔 경고만 유지.

### D. 진행률 업데이트 스로틀

- `setFiles(progress)` 를 매 배치 → **200ms 스로틀** (또는 최소 5% 변화 시). 리렌더 부하 축소.

### E. 배치 에러 fallback 스마트화

- 현재는 오류시 슬라이스를 1행씩 개별 upsert. 이 경로가 진짜 병목 (150회 순차). **이분 탐색(binary split)** 으로 변경: 배치 실패 → 반으로 쪼개 재시도, 결국 실패한 소수 행만 개별 처리. 대량 정상 행이 있을 때 왕복 수를 log(N)로 감소.
- 로그의 `defect_items_raw_team_check` 위반은 별도 이슈지만, 이 개선으로 위반행 몇 개 때문에 전체가 느려지지 않게 됨. (별도로 원인 조사 필요하나 이번 스코프 밖.)

### F. upsert 응답 최소화 명시

- `.upsert(slice, { onConflict: "source_issue_no", ignoreDuplicates: false })` 그대로 두되, supabase-js가 기본 minimal 반환을 사용하도록 `.select()` 는 계속 미사용. (이미 적용됨, 유지 확인만.)

## 스코프 밖 (별도 제안)

- **Edge Function/서버 함수로 이관**: 대량 파일이면 브라우저→서버→DB 왕복이 근본 병목. 파일을 storage에 업로드 후 서버에서 COPY/INSERT 하면 대형 파일에서 10배 이상 빨라질 수 있음. 요청 시 별도 계획으로 진행 권장.
- **`team_check` 제약 위반 실제 원인**: `null` 또는 목록 밖 값. `pickTeam` 이 null 이면 base.team=null 이 됨 — 제약이 NOT NULL 이거나 enum이면 위반. 필요시 별도 진단.

## 검증

- 대형(수천 행) 샘플 파일로 개선 전/후 총 소요시간 비교 (콘솔에 `performance.now()` 로그 임시 추가).
- `bunx tsgo --noEmit` 통과.
- 기존 성공/실패/부분성공 경로 회귀 확인 (특히 배치 오류 발생 시 이분탐색 결과 카운트가 이전과 동일하게 집계되는지).

## 변경 파일

- `src/contexts/DefectManagementImportContext.tsx` 만 수정.
