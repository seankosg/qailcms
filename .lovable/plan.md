## 최종 계획 (사용자 결정 반영)

- 오염된 sub 6개는 `actual_progress / 100` 자동 복구
- 향후 방지: **TM 전체의 Actual Progress 입력은 % 단위(0~100)** 로 통일

### 1. 편집 UI: percent 컬럼을 % 단위로 (핵심 원천 차단)

`src/components/task-management/raw-data/EditCellPopover.tsx` (Raw Data + Detail 공용):

- `column.type === "percent"` 분기 추가
  - 초기 표시값: `Math.round((v ?? 0) * 1000) / 10` (예: 0.3 → 30.0)
  - `<input type="number" min={0} max={100} step="0.1" />` + 우측 "%" 라벨
  - 저장 직전 변환: `saved = clamp(Number(input) / 100, 0, 1)` 후 소수 4자리 반올림
  - NaN·음수·>100 → 토스트 경고 + 저장 취소
- Detail(`TaskDetailPage.tsx`)의 percent 편집 경로도 같은 팝오버를 쓰므로 자동 반영

### 2. Bulk Edit / Row Add 등 다른 입력 경로 점검·통일

`rg "actual_progress|plan_progress"` 로 식별된 사용자 입력 경로 전수 조사 후 다음도 % 단위로 통일:

- Bulk Edit 다이얼로그(있으면) — actual_progress 입력 필드
- 신규 행 추가 폼(있으면)
- 이 조사에서 발견되는 모든 percent 컬럼 입력을 동일 규약(값 표시 % / 저장 fraction)으로 맞춤

식별 후 발견된 각 지점은 계획 실행 중 개별 수정. 미발견 시 이 항목 무해 스킵.

### 3. 임포트 파서 방어

`src/lib/task-management/parser.ts` `toPct4`:

- `n > 1` 이면 `n = n / 100` (엑셀에서 "%" 서식 없이 "30"만 입력된 셀 방어)
- 이후 `[0, 1]` 로 클램프 후 소수 4자리 반올림
- 동일 로직을 `plan_progress`, `progress_variance` 에도 자동 적용(기존 호출부 그대로 유지)

### 4. DB 안전망 트리거 (마이그레이션)

`task_management_raw`, `defect_items_raw` 에 BEFORE INSERT/UPDATE 트리거 `trg_*_clamp_progress`:

- 대상: TM `actual_progress`, `plan_progress` / DMR `actual_progress_pct`, `planned_progress_pct`
- `if v > 1 then v := v / 100; end if;` → `v := least(1, greatest(0, v))`
- 어떤 경로(수동편집·임포트·트리거·SQL)로 들어와도 [0,1] 강제 유지

### 5. 롤업 함수 정규화 (마이그레이션)

`update_task_summary` 재정의:

- sum 계산의 `actual_progress` / `plan_progress` 를 `least(1, greatest(0, coalesce(..., 0)))` 로 감쌈
- `all_finished` 도 정규화된 값 기준
- 저장 직전 결과에도 최종 `least(1, ...)`

### 6. 판정 함수 방어 (마이그레이션 + TS)

- DB `calc_auto_judgment_value`: 진입부 `actual := least(1, greatest(0, coalesce(_actual_progress, 0)))`
- TS `src/lib/task-management/derived.ts` `computeJudgment`: `actual_progress` 사용 지점 모두 클램프
- `TaskTreePage.tsx` `resolveMainJudgment`: 
  - kids `actual_progress` 클램프 후 `allDone` 재판정
  - **kids 가 있고 `allDone === false` 인 main 은 어떤 경우에도 "완료" 를 반환하지 않도록** 명시 가드 추가 (현재는 syntheticMain 을 computeJudgment 로 위임하여 rolledActual 만으로 완료 판정 발생)

### 7. 오염 데이터 복구 (insert 도구)

TM 사용자 결정에 따라 자동 `/100`:

```sql
UPDATE public.task_management_raw
   SET actual_progress = LEAST(1, actual_progress / 100.0)
 WHERE level = 'sub' AND actual_progress > 1;

UPDATE public.task_management_raw
   SET plan_progress = LEAST(1, plan_progress / 100.0)
 WHERE level = 'sub' AND plan_progress > 1;

SELECT public.rollup_task_all_mains('ARCH');
SELECT public.rollup_task_all_mains('ELEC');
SELECT public.rollup_task_all_mains('MECH');
SELECT public.recalc_task_auto_judgment();
```

- 실측 오염: sub 6행(EL-C-13-03=99, C-14-01=85, C-19-01=30, D-10-01=30, D-12-01=85, D-17-01=30), main 6행은 롤업으로 자동 정정
- DMR 은 현재 오염 0건이나 구조적 방어(1·4항)는 동일 적용

### 8. 검증

- `SELECT count(*) FROM task_management_raw WHERE actual_progress > 1 OR plan_progress > 1;` → 0
- `SELECT task_no, actual_progress, auto_judgment FROM task_management_raw WHERE task_no IN ('EL-D-17','EL-D-17-01','EL-D-17-02');` — main 은 kids 미완이므로 완료 아님, 01=0.30/정상, 02=0.20/정상
- 프리뷰에서 EL-D-17 카드가 완료 스타일 미적용, sub 01=30% / sub 02=20% 로 표시, 편집 팝오버가 % 단위로 열리고 "30" 입력 시 DB 에 0.30 저장

### 9. 사용자 안내 (UI 문구)

편집 팝오버 입력창 하단에 소형 힌트 "0~100 사이 % 값 입력 (예: 30)" 표기 및 컬럼 라벨은 기존 "Actual %" 유지.
