## 목표
파일 내 동일 부모 하위에 `task_no`가 중복될 때 파서가 자동으로 다음 사용 가능한 마지막 세그먼트로 재번호를 부여하고, 경고 목록에 남긴다.

## 현재 상태
`src/lib/task-management/parser.ts` 의 행 순회 루프는 중복 검사를 하지 않아, 같은 `task_no` 두 개(예: `EL-D-04-03` × 2)가 그대로 parsed rows에 들어가고 이후 DB unique key 충돌/중복 점검 다이얼로그가 뜬다.

## 변경 (파일 1개: `src/lib/task-management/parser.ts`)

1. 행 순회 루프(416~491) 바깥에 `seenTaskNos = new Set<string>()`, 그리고 부모별 카운터 `usedByParent = new Map<string, Set<string>>()` 준비.
2. 각 행에서 `taskNo`(교정 후) 확정 직전에 중복 여부 검사:
   - `seenTaskNos.has(taskNo)` 이면 재번호 필요.
   - 재번호 규칙:
     - 부모(parent)인 경우: `${parent-of-current}-${nextSeq}` 형태로 다음 미사용 2자리 시퀀스를 찾음. parent에도 접두어(예: `EL-D-04`)가 있으므로 그 접두어 기준으로 tail 후보를 `01..99`까지 순회.
     - 자식인 경우: `${structParent}-${nextSeq}` 로 부모 하위에서 안 쓰인 2자리 시퀀스를 찾음.
   - 시퀀스 산정은 `allTaskNos` + `seenTaskNos` 양쪽을 모두 봐서 파일 다른 곳/이미 방출된 것과 겹치지 않도록 함.
   - 확정된 새 값을 `taskNo`에 대입, `warnings.push` 로 `행 ${r}: task_no '${원본}' 중복 → '${새값}' 로 자동 재번호` 기록.
3. 매 행 마지막에 `seenTaskNos.add(taskNo)` 로 추가.

## 유의점
- 재번호 규칙은 "부모 접두어 유지 + 마지막 세그먼트 재할당" 이므로 계층은 변하지 않음. 즉 부모/자식 관계는 그대로.
- 접두어 mismatch 자동 교정(451행) 이후에 중복 검사가 오도록 순서 유지. 두 교정이 모두 발생하면 경고 두 줄 나옴.
- 시퀀스 폭은 원래 tail 자리수를 참고: 대부분 2자리(`01`)지만 `01-01` 처럼 3세그먼트 tail도 존재. 안전을 위해 우선 2자리로 시도, 실패 시 3자리까지 폴백.
- 100개까지 순회해도 빈 자리가 없으면(비현실적) 원본 유지 + 강한 경고.

## 검증
- 업로드하신 `Task_Management_전기_260713.xlsx` 로 다시 임포트 → `EL-D-04-03` 두 번째 행이 `EL-D-04-05`(또는 그 다음 미사용 번호)로 자동 재번호되고 경고 1줄 표시, 중복 점검 다이얼로그는 뜨지 않음.
- `bunx tsgo --noEmit` 통과.

## 변경 파일
- `src/lib/task-management/parser.ts` (약 25~35줄 추가)
