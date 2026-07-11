## 비교 결과 요약

업로드한 `20260710_Task_Management_건축-5.xlsx` (Gantt 시트, 137행) 를 DB `task_management_raw` (`discipline='건축'`, 134행) 와 비교했습니다.

- **행 존재**: task_no 기준 완전 일치 (134개 공통, 엑셀에만/DB에만 있는 task_no 없음).  
  ※ 엑셀에는 137행이 있지만 이 중 3행은 dedupe/parent 처리로 실제 저장 대상은 134행.
- **필드 값 불일치**: **총 313건**
  | 필드 | 불일치 건수 |
  |---|---|
  | `plan_start` | **134** (전 행) |
  | `plan_end`   | **134** (전 행) |
  | `actual_start` | **45** (값이 있는 모든 행) |
  | 그 외 (`plan_days`, `actual_progress`, `plan_progress`, `progress_variance`, `slip_days`, `forecast_end`, `category`, `plot`, `task_name`, `risk`, `sub_task_desc`, `pic`, `row_type`, `status_manual`, `auto_judgment`) | **0** |

---

## 원인 — 날짜 파싱 UTC/로컬 시간대 버그

모든 불일치가 **날짜 필드에서 정확히 하루 이르게(-1일) 저장**됨. 예:

| task_no | 필드 | Excel | DB |
|---|---|---|---|
| AR-C-T-01 | plan_start | 2026-05-02 | 2026-05-01 |
| AR-C-T-01 | plan_end   | 2026-09-03 | 2026-09-02 |
| AR-C-T-01 | actual_start | 2026-04-29 | 2026-04-28 |
| AR-C-P-01 | plan_start | 2026-07-04 | 2026-07-03 |

원인은 `src/lib/task-management/parser.ts` 의 `toIsoDate`:

```ts
if (v instanceof Date) {
  const y = v.getUTCFullYear();
  const m = String(v.getUTCMonth() + 1).padStart(2, "0");
  const d = String(v.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
```

`xlsx` 라이브러리가 `cellDates:true` 로 반환한 `Date`는 **로컬 자정** (예: `2026-05-02 00:00 KST`)으로 생성되는데, `getUTC*` 로 읽으면 UTC로 환산되면서 `2026-05-01`이 됨. KST(+09:00)든 어떤 양의 오프셋이든 하루가 밀림.

---

## 계획 — 파서 수정 + 재임포트

### A. `toIsoDate` 로컬 컴포넌트로 교체
`getUTC*` → `getFullYear/getMonth/getDate` 로 변경. Excel 시리얼 파싱 (`XLSX.SSF.parse_date_code`) 분기는 이미 로컬 y/m/d를 반환하므로 그대로 유지.

파일: `src/lib/task-management/parser.ts` (L72~78, `toIsoDate` 내부의 `Date` 처리 분기 3줄)

### B. 재임포트 안내
파서 수정 후 사용자가 `20260710_..._건축-5.xlsx` 를 다시 Import 하면:
- 134개 row 의 `plan_start`, `plan_end`, `actual_start` 가 하루씩 뒤로 보정됨
- `data_date`는 `2026-07-09` → `2026-07-10` 으로 갱신
- `dataDate`가 이번 파일에서는 D4(=2026-07-10)에서 이미 정상 감지됨 (직전 세션에서 파서 유연화 적용됨)

### C. 검증
재임포트 후 동일 비교 스크립트를 다시 실행해 불일치 0 인지 확인.

---

## 참고
- `sub_task_desc`, `category`, `plot`, `pic` 등 텍스트 필드는 완전 일치했으므로 컬럼 매핑 자체는 정상.
- `auto_judgment` 필드는 이 파일 전 행이 비어 있고 DB도 `auto_judgment_import`가 비어있어 일치. `auto_judgment_import` 대신 재계산된 `auto_judgment` 컬럼은 rollup + judgment recalc 로직이 채우므로 비교 대상에서 제외.
- 313 = 134 + 134 + 45 완전한 산술적 대응 → 데이터 무결성 관점에서 다른 이상은 없음.
