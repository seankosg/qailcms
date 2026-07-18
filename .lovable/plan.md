원인은 업로드하신 파일이 SM Raw Data에서 내보낸 `View-friendly` 형식이고, 실제 헤더가 8행의 `ID No`로 되어 있는데 현재 import 파서는 유니크 키로 `source_issue_no`, 원본 `ID`, 또는 등록 alias만 인정하기 때문입니다. 그래서 `ID No`를 `source_issue_no`로 연결하지 못해 `필수 헤더 누락: ID`가 나오고, 유니크 키 컬럼이 없으니 읽을 행도 0건으로 처리되어 `행을 찾지 못했습니다`가 같이 표시됩니다.

구현 계획:
1. `src/lib/defect-management/parser.ts`의 `source_issue_no` 전용 resolver에 `ID No`를 안전한 alias로 추가합니다.
   - `ID No`, `Issue No`, `Source Issue No` 등 SM View-friendly export에서 나올 수 있는 표시명을 `source_issue_no`로 인식하게 합니다.
   - 기존 UUID 방어 로직은 유지해서 시스템 내부 UUID 컬럼이 유니크 키로 잘못 들어가는 문제는 계속 차단합니다.
2. `toDefectFieldName`에도 같은 표시명 매핑을 추가합니다.
   - Column Select 화면에서 `ID No`가 필수 ID 필드로 표시되고, 사용자가 실수로 제외하지 않도록 기존 경고/필수 처리와 연동합니다.
3. 가능하면 export 쪽도 재검토합니다.
   - `Re-import ready`는 계속 내부 필드명 `source_issue_no`를 사용합니다.
   - `View-friendly`는 사람이 보기 좋은 `ID`/`ID No`를 유지하되, import가 해당 헤더를 받아들일 수 있게만 고칩니다.
4. 업로드된 `defect-raw-VIEW-설비_no_plan_R1.xlsx` 기준으로 파서가 8행 헤더를 감지하고, 9행부터 1,100여 행을 읽는지 확인합니다.

수정 후 기대 결과:
- 같은 파일 import 시 `필수 헤더 누락: ID`가 더 이상 나오지 않습니다.
- `행을 찾지 못했습니다`도 유니크 키 미인식으로 인한 경우는 사라집니다.
- 기존 `source_issue_no` / 원본 `ID` / Re-import 파일의 동작은 유지됩니다.