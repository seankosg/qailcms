# Defect Import 속도 개선 — 확정 계획

## 목표
현재 남아있는 두 병목(트리거로 인한 UPDATE 폭증, `raw_payload` 대량 전송)을 제거해 재임포트 소요시간을 크게 단축한다. Category→Team 매핑은 병목이 아니므로 손대지 않는다.

## 작업

### 1단계 — RPC 배치 upsert 도입 (효과 큼)
**목적**: 재임포트에서 실질적 변경이 없는 행이 트리거를 발동시키지 않게 하고, 배치 왕복을 그대로 유지하되 no-op UPDATE 제거.

- 마이그레이션으로 `public.upsert_defect_items_batch(_rows jsonb)` 함수 생성.
  - 인자: 행 배열(jsonb). 클라이언트가 넘기던 payload와 동일 구조.
  - 내부: `INSERT INTO defect_items_raw SELECT ... FROM jsonb_to_recordset(_rows) ON CONFLICT (source_issue_no) DO UPDATE SET <컬럼 나열> = EXCLUDED.<컬럼> WHERE (기존 컬럼들) IS DISTINCT FROM (EXCLUDED 컬럼들)`.
  - 반환: `jsonb { inserted, updated, skipped_noop }`.
  - `SECURITY DEFINER` + `SET search_path = public`. 호출자에 `authenticated` GRANT EXECUTE.
- 클라이언트 `src/contexts/DefectManagementImportContext.tsx`의 `upsertBatch` 를 `supabase.rpc("upsert_defect_items_batch", { _rows: slice })` 호출로 교체.
- 이분탐색 fallback 유지: RPC 에러(check 제약 등) 시 배치를 반으로 나눠 재시도해 위반 행 격리.
- 병렬성 `BATCH_CONCURRENCY` 4 → 6 상향. 트리거 부하가 줄어 여유 확보.

### 2단계 — raw_payload 무변경 시 스킵 (네트워크 절감)
- 마이그레이션으로 `defect_items_raw.raw_payload_hash text` 컬럼 추가 + BEFORE INSERT/UPDATE 트리거로 `md5(coalesce(raw_payload::text,''))` 자동 세팅.
- existing 조회 시 `raw_payload_hash`도 함께 select.
- 클라이언트에서 payload MD5 계산 후 기존 hash와 같으면 그 행의 payload에서 `raw_payload` 필드만 제외(다른 컬럼 변경은 그대로 반영).
- 신규 행은 그대로 전송.

### 3단계 — 실측 로그
- 임포트 전/후, 배치별 소요시간을 콘솔에 임시 기록. 개선 폭 확인 후 로그 정리.

## 범위 밖
- Category→Team 매핑 로직(병목 아님).
- `defect_status_history` 스키마 개편.
- Edge Function 이관.

## 검증
- `bunx tsgo --noEmit` 통과.
- 대형 샘플 파일로 1·2단계 각각 적용 전/후 총 소요시간 비교.
- 기존 성공/실패/부분성공/이분탐색 fallback 회귀 확인.
- RLS/권한: 기존 authenticated 사용자 정상 임포트.

## 변경 파일
- 신규 마이그레이션 SQL(1·2단계 함수/컬럼/트리거/GRANT).
- `src/contexts/DefectManagementImportContext.tsx` (upsertBatch RPC 전환, hash 스킵, 병렬성 상향).

## 순서
1단계 먼저 배포·실측 → 부족하면 2단계 추가. 1단계만으로 충분히 개선될 가능성이 높다.
