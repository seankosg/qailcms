# ABD 판정 단일 소스화 계획 (2026-07-29)

## 원자 마이그레이션 M1 — 정본 함수 + 계약 전환
1. `public.abd_judge_v1(<라운드별 plan/actual 필드 26개>, latest_status, is_terminated, _as_of date)`
   `RETURNS jsonb`, `IMMUTABLE SECURITY INVOKER search_path=public`.
   반환 키: `active_round`, `current_stage`, `bucket_top`, `delay_bucket[]`,
   `excluded`(=Cancelled), `needs_planning`, `needs_revise`,
   `revise_source_round`, `rs_result_missing`, `ur_aging_days`.
   `abd_compute_derived` 트리거의 현행 로직을 그대로 1:1 이식(의미 무변경).
2. `abd_compute_derived` 트리거: 내부 계산 삭제 후 `abd_judge_v1` 결과를
   NEW.* 파생 컬럼에 매핑(저장 동작 유지).
3. `abd_judge_at_date(_ids, _as_of)` 재작성: `abd_judge_v1(...)` 호출로 통일.
4. 대시보드 RPC 버킷 계산부(row1/row2/status_dist/judgment_mix/attention/
   crosscut/overdue_heatmap) 전부 `abd_judge_v1(...) _as_of := $as_of` 기준으로
   교체. 시그니처 추가/변경 시 구 시그니처 `DROP FUNCTION` 동시 포함.
5. `abd_items_search` `_status_group` 어휘를 정본 버킷(All/Approved/Unapproved)
   + 옵션 `_bucket text[]`(NS/DS/UR/Approved/RESUBMIT/NoPlan/Delayed…)로 재정의.
   `_bucket` 파라미터 추가는 default NULL 로 하위호환.
6. 백필: `abd_judge_v1` 결과와 stored 4컬럼 diff 를 카운트 후 diff 행에만 UPDATE.
   결과가 전체 30% 초과면 중단·보고.

## 코드 패치 P1 — 콜사이트/UI/클라 사본 제거
- `src/lib/abd/dashboard-data.ts` 의 판정 함수(isApproved/deriveStage/…) 제거,
  대신 서버 반환 필드 소비.
- `src/components/abd/raw-data/AbdRawDataPage.tsx`
  - status 탭: All / Approved / Unapproved (+ Excluded) 로 축약.
  - URL search `status=not_started|in_progress` → `bucket=NS|DS,UR,RESUBMIT,…` 매핑 어댑터.
  - `latest_status='A'` 클라 오버라이드 코드(:935,:1006) 삭제.
- 대시보드 카드 클릭: 링크 파라미터를 `status=unapproved&bucket=<정본버킷>` 로
  전달, Raw Data 상단에 필터 칩(판정: <라벨>) 노출(TM KPI 뱃지 동일 패턴).
- 배포 마커 `ABD_JUDGE_V1_2026_07_29` 를 `AbdRawDataPage.tsx` 런타임 참조에 삽입.

## 완료 보고 항목
- 수정 전/후 실측표: 전 버킷 × (카드 숫자, 드릴다운 건수) — 재현 케이스 Plot C NS MECH 포함.
- stored vs 정본 diff 백필 건수 + 방향별 이동 요약.
- 클라 사본 grep 0건 + published 번들 마커 검출.
- 범위 밖 발견 사항 BACKLOG 등재 목록.

## 턴 간 호환성 (M1 필수)
- `abd_items_search._status_group` 은 신규 어휘(All/Approved/Unapproved) + 구 어휘(not_started/in_progress/…) 를 **모두 수용**. 내부에서 신규 버킷으로 매핑. 구 어휘 제거는 P1 배포 확인 후 별도 마이그레이션.
- 시그니처 확장되는 모든 RPC(`abd_items_search`, `abd_judge_at_date`, 대시보드 RPC 7종)의 신규 파라미터(`_bucket`, `_as_of` 등)는 **DEFAULT NULL** 을 부여하여 구 콜사이트(named-arg) 가 신 시그니처에만 유일 매칭되도록 한다. 구 시그니처는 같은 마이그레이션에서 `DROP FUNCTION` (TM PGRST203 예방).
- M1 적용 직후 운영 화면(대시보드/Raw Data) 정상 동작 확인 후 턴 2 진행.

## 백필 가드
- diff 대상 건수를 `RAISE NOTICE` 로 로그. 전체 30% 초과 시 UPDATE 만 SKIP 하고 함수/트리거/RPC 교체는 계속. 완료 보고에 diff 요약 첨부.

## 실행 순서
- 턴 1 (현재): M1 마이그레이션 제출 → 승인·실행 → typegen 자동 재생성 → 운영 화면 정상 확인.
- 턴 2 (연속): P1 코드 패치(클라 사본 제거, 탭 축약, `_bucket` 배선, 마커 삽입) → 재배포 → 마커 검출 + 전 버킷 정합 실측표 보고.
