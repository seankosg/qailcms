## 원인 요약 (실측)

`defect_header_mappings` 조회 결과 두 매핑 모두 `is_active=true`로 등록됨:
- `Start Status` → `start_status`
- `planned_completion_date (Rectification Date)` → `planned_rectified_date`

그럼에도 SM 임포트 다이얼로그에서 `(unmapped)`로 보이는 이유는 두 가지가 겹침.

**A. `start_status`는 서버 파생 필드라 임포트 화이트리스트에 없음**
- `src/lib/defect-management/columns.ts:178` — `start_status`는 `derived: true`(서버 계산).
- `src/lib/defect-management/parser.ts`의 `DEFECT_TARGET_FIELDS`(8–41행)와 `EXTRA_REIMPORT_FIELDS`(89–116행) 어디에도 `start_status`가 없음 → `isKnownDefectField("start_status")` = false → 다이얼로그 238–239행에서 `(unmapped)` 표시. 값도 저장되지 않음.

**B. `planned_rectified_date`는 정상 대상 필드지만 alias 캐시가 갱신되지 않음**
- `planned_rectified_date`는 `EXTRA_REIMPORT_FIELDS`(105행)에 존재 → 원칙상 매핑됨으로 표시되어야 함.
- `DefectManagementImportContext.parseAndApply`(395–453행)는 파일 추가 시점에만 `fetchAliases()`를 호출. 관리자 탭에서 매핑을 추가/수정한 뒤 이미 올려둔 파일은 재파싱되지 않아 새 alias가 반영 안 됨. 파일을 지우고 다시 추가하면 매핑됨.

사용자 결정: **파생 필드 매핑은 실수이므로 제거**.

---

## 수정 계획

### 1) DB 정리 — 파생 필드로 걸린 잘못된 매핑 제거
- 마이그레이션으로 `defect_header_mappings`에서 target_field가 파생/시스템 필드인 행을 비활성화(하드 삭제 대신 `is_active=false` + 감사 흔적 유지).
  - 초기 대상: `start_status` (그리고 `columns.ts`에서 `derived: true`인 모든 필드, 예: `stage`, `finish_status` 등 존재 시 함께 정리).
- 동일 마이그레이션에서 `abd_header_mappings`, `task_management_header_mappings`, `spare_part_header_mappings`에도 같은 정책 적용 여부는 후속 논의(이번 스코프는 SM만).

### 2) 관리자 매핑 UI에서 파생/비임포트 필드 선택 차단
- `src/components/admin/**` 중 SM Header Mapping 편집 화면(Target Field 셀렉트): 옵션 소스에서 `derived: true` 필드 제외. 이미 저장된 파생 매핑은 목록에 붉은 배지("파생 필드 — 임포트 불가")로 표시하고 비활성화 상태로만 노출.
- 저장 검증: 신규/수정 시 파생 필드 target 선택은 서버 유효성으로도 거절(가벼운 RPC 또는 CHECK 컨스트레인트 대신 클라이언트+SQL 트리거).

### 3) 관리자 매핑 최신화 반영(캐시 문제)
- `DefectManagementImportContext`에 `refreshAliases()` 추가.
- 임포트 페이지 마운트 시, 그리고 컬럼 선택 다이얼로그 열릴 때 `fetchAliases()`를 재실행하여 이미 파싱된 파일들의 `headerToFieldMap`만 재계산(원본 재파싱 불필요). 새 alias만 반영하면 되므로 성능 영향 없음.
- 다이얼로그 헤더 우측에 작은 "매핑 새로고침" 버튼 추가(관리자 매핑을 방금 바꾼 사용자용 명시 경로).

### 4) 검증
- 마이그레이션 후 `defect_header_mappings`에서 `target_field='start_status'` 행이 `is_active=false`인지 확인.
- SM 임포트에서 `Start Status` 헤더가 다이얼로그에 뜨더라도 매핑 대상이 없으므로 정상적으로 "(unmapped)"로 남고, 관리자 UI에서는 해당 target을 선택할 수 없어야 함.
- 관리자 UI에서 `planned_completion_date (Rectification Date) → planned_rectified_date` 신규 저장 후, 임포트 페이지에서 파일 재선택 없이 "매핑 새로고침" 한 번으로 mapped 표시되고 실제 임포트 시 `planned_rectified_date` 값이 저장되는지 확인.

## 기술 세부

- 마이그레이션 파일(신규): `UPDATE public.defect_header_mappings SET is_active=false, updated_at=now() WHERE target_field IN (<derived list>);` — 값은 `columns.ts`의 `derived: true` 목록에서 확정.
- Target Field 옵션 소스는 이미 `columns.ts` 기반이므로 필터 한 줄 추가로 UI 차단 가능.
- `refreshAliases`는 새 상태로 setFiles 안에서 `headerToFieldMap`만 다시 계산(파일별 `availableHeaders`를 이용, 원본 File을 다시 읽지 않음).
