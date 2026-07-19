## 원인

SM 임포트 컬럼 선택 다이얼로그의 "매핑 필드" 컬럼은 `parseDefectExcel`이 반환하는 `headerToFieldMap`을 그대로 표시합니다. 이 맵은 `toDefectFieldName()`으로 채워지는데, `src/lib/defect-management/parser.ts:490` 에서 다음 규칙이 있습니다.

```ts
if (norm === "id") return "";  // "ID"/"id" 헤더는 시스템 컬럼으로 간주해 매핑 제거
```

반면 실제 파싱 시에는 별도 함수 `resolveSourceIssueNoColumn()`이 LetsBuild 원본 파일에서 `"ID"` 헤더를 **`source_issue_no`로 승격**해서 사용합니다 (parser.ts:394, 466-468). 즉:

- 실제 임포트 로직: `ID → source_issue_no` (정상 동작)
- 다이얼로그 표시용 맵: `ID → ""` → UI에서 `(unmapped)` 로 표시

그래서 "매핑되어 있는데 언맵드로 보이는" 현상이 발생합니다.

부차적 문제: `DefectColumnSelect.getRequirement()`는 `field === "source_issue_no"`일 때만 필수 잠금을 거는데, `ID` 헤더는 field가 빈 문자열이라 **필수 컬럼 잠금이 걸리지 않습니다**. admin이 아닌 사용자도 ID를 체크 해제할 수 있어 임포트 실패로 이어질 수 있습니다.

## 수정 방안

1. `parseDefectExcel`이 `headerToFieldMap`을 만들 때, `resolveSourceIssueNoColumn`이 실제로 채택한 컬럼(레터/헤더)을 알아내어 그 헤더의 매핑을 `"source_issue_no"`로 덮어씌운다.
   - resolver는 이미 `{col, origin}`을 반환하므로, `entries`에서 해당 letter를 찾아 원본 헤더 문자열을 얻고 `headerToFieldMap[thatHeader] = "source_issue_no"`로 설정.
   - 이렇게 하면 LetsBuild 원본의 "ID", View export의 "ID No", 별칭으로 지정된 헤더 모두 다이얼로그에서 `source_issue_no` (Aconex 배지 포함) 로 표시됨.

2. 필수 잠금은 (1)이 반영되면 기존 `field === "source_issue_no"` 분기로 자동 잠금됨. 별도 코드 변경 불필요.

3. 회귀 방지 확인 항목:
   - Re-import 파일(헤더가 이미 `source_issue_no`인 경우) — resolver 경로 (2) 로 잡히므로 동일하게 정상 표시.
   - UUID 오염으로 resolver가 컬럼을 거부한 경우 — `sk.col === null`, 덮어쓰기 스킵 → 기존과 동일하게 unmapped.
   - `excludedFields`에 `source_issue_no`가 이미 있으면 resolver 자체를 건너뛰므로 그대로 unmapped(현재 동작 유지).

## 변경 파일

- `src/lib/defect-management/parser.ts` — `parseDefectExcel` 내부, resolver 호출 직후 `headerToFieldMap` 보정 블록 추가 (약 5줄).

다른 파일은 수정하지 않습니다. TM/ABD 임포트는 이 경로를 사용하지 않으므로 영향 없음.
