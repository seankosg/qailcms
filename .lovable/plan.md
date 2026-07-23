## 원인 (쉬운 설명)

임포트 자체가 아니라 **DB 트리거의 잔재** 때문입니다.

- 이전에 ABD의 `pic` 필드를 `hdec_pic_name` + `hdec_eng_name` 두 개로 분리하는 마이그레이션을 진행하면서, 실제 컬럼(`abd_items_raw.pic`)은 삭제되었습니다.
- 그런데 두 개의 트리거 함수가 아직도 존재하지 않는 `NEW.pic`을 참조하고 있습니다:
  1. `abd_auto_owner_user_id()` — INSERT/UPDATE 시 담당자로 소유자를 자동 매핑
  2. `trg_abd_change_log_fn()` — UPDATE 변경 이력을 `abd_change_log`에 기록
- 임포트가 첫 행을 INSERT 하는 순간 Postgres가 `record "new" has no field "pic"` 에러를 던져 파일 전체가 "0 ready to import"로 막힙니다.

즉 **엑셀 파일에는 문제가 없습니다.** 컬럼을 아무리 손봐도 트리거가 존재하지 않는 `pic`을 찾고 있어서 계속 실패합니다.

## 대책

### 방법 A — 엑셀 원본을 수정 (권장하지 않음, 근본 해결 불가)

이 에러는 셀 값이 아니라 서버 측 트리거 문제라서, 엑셀 컬럼 어떤 것을 지우거나 바꿔도 해결되지 않습니다. 굳이 우회하려면 임포트 시점에 change_log 트리거를 회피해야 하는데, 이는 사용자가 엑셀에서 할 수 있는 조치가 아닙니다. 따라서 이 경로는 유효한 해결책이 아님을 명시.

### 방법 B — 시스템에서 완화 (정답, 마이그레이션으로 처리)

DB 트리거 함수 2개를 신 스키마(`hdec_pic_name`, `hdec_eng_name`)에 맞게 재작성:

1. `abd_auto_owner_user_id()` 재작성
   - 기존: `NEW.pic` 참조
   - 변경: `NEW.hdec_pic_name`(우선) → 없으면 `NEW.hdec_eng_name`으로 `resolve_owner_by_name()` 호출
   - UPDATE 조기 반환 조건도 `hdec_pic_name`/`hdec_eng_name`의 변화 여부로 판단
2. `trg_abd_change_log_fn()` 재작성
   - `fields` 배열에서 `'pic'` 제거, 대신 `'hdec_pic_name'`, `'hdec_eng_name'` 추가
   - 나머지 24개 필드(문서·라운드 스테이지·상태)는 그대로 유지
3. 마이그레이션 하나로 `CREATE OR REPLACE FUNCTION` 두 개 실행 (RLS·정책·GRANT·기존 데이터 변경 없음, 위험도 낮음)

## 검증

1. 문제의 파일 `PLOT C&D ELEC ABD 완료계획_260723_.xlsx` 재업로드 → 파일 카드가 "정상 ready" 상태로 진입, 임포트 성공
2. 임의의 행에서 `hdec_pic_name`을 수정 → `abd_change_log`에 정확히 기록되는지 확인
3. 임포트 시 owner_user_id가 `hdec_pic_name` 기준으로 매핑되는지 표본 확인

## 사용자에게 드리는 답변 요약

- 엑셀 파일에는 잘못이 없습니다. 수정할 컬럼도 없습니다.
- 시스템 측 잔여 트리거(구 `pic` 컬럼 참조) 두 개를 신 컬럼으로 재작성하는 마이그레이션으로 해결합니다.
