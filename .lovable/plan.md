## 문제

Aconex 임포트 로그에 팀이 **자동으로 "MECH"** 로 기록되고 있습니다.

**원인** (`src/lib/abd/aconex-import.functions.ts:247`):
```ts
team: "MECH", // Aconex 는 team 무관, NOT NULL 스키마 회피
```
`abd_import_logs.team` 컬럼이 NOT NULL 이라 하드코딩 "MECH"로 우회한 상태. 그 결과 화면 스크린샷처럼 Aconex 파일(`Plot C_ABD_Aconex_260726.xlsx` 등)이 모두 MECH로 표시됨. Aconex는 파일 하나에 팀이 섞여 있으므로 팀 개념 자체가 부적절.

## 해결 방안

### 1. DB 마이그레이션 — `abd_import_logs.team` NULL 허용
```sql
ALTER TABLE public.abd_import_logs ALTER COLUMN team DROP NOT NULL;
```
- 기존 HDEC 로그의 team 값은 유지.
- 신규 Aconex 로그는 `team = NULL` 저장 가능.

### 2. Aconex 임포트 코드 수정 (`src/lib/abd/aconex-import.functions.ts:247`)
- `team: "MECH"` → `team: null` 로 교체하고 회피용 주석 제거.

### 3. 기존 Aconex 로그 소급 정리 (선택)
Aconex 로그는 `sheet_name = "Docs (Aconex)"` 로 명확히 구분 가능:
```sql
UPDATE public.abd_import_logs
SET team = NULL
WHERE sheet_name = 'Docs (Aconex)';
```
이렇게 하면 기존 로그의 잘못된 MECH 표기도 함께 "—"로 표시됨.

### 4. 화면 표시 확인 (`src/components/import/ImportLogsPage.tsx`)
- 이미 `r.team`을 그대로 렌더링하며 NULL일 경우 스크린샷의 HDEC 열에서 이미 사용 중인 "—" placeholder 로 표시됨. 별도 UI 수정 불필요 (확인만 필요).

## 확인 사항

- **기존 Aconex 로그 소급 정리**: 함께 진행할지 여부. (권장: 진행 — 잘못된 MECH 표기가 사용자 혼란을 계속 유발)
- Aconex 로그를 대시보드/분석에서 팀 기준으로 집계하는 다른 코드가 있는지는 사전 검토 결과 없음 (`abd_import_logs`는 화면 표시 및 backup 대상 테이블 목록에만 사용).
