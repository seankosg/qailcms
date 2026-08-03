# SM Raw Data — 파생/자동채움 필드 역할 기반 편집 허용

## 목표
SM Raw Data 표에서 임포트·분류기가 자동으로 채우는 텍스트 필드(Building, Room, Level, Plan Group 등)를
사용자 역할에 따라 인라인 편집할 수 있게 하고, 수동으로 고친 값은 다음 임포트/재계산에 덮어써지지 않게 보존한다.

## 현재 상태 (실측)
| 항목 | 파일:라인 | 현재 |
|---|---|---|
| 서버 저장 게이트 | `src/lib/defect-management/mutations.functions.ts:38` `assertAdmin` | admin/superuser만 저장 가능 |
| 클라이언트 행 권한 | `src/lib/auth/roles.ts:67` `canEditRawRow` | senior_user 전체 / user 본인 PIC 행 / d_superuser 팀 일치 |
| 셀 편집 판정 | `DefectRawDataPage.tsx:1184` | `c.editable && c.editorType && canEditRow(row)` |
| 자동채움 텍스트 필드 | `columns.ts:146~166` | `editable` 없음 → 편집 UI 자체가 없음 |
| 잠금 컬럼 | `defect_items_raw` | `priority_locked`, `hdec_verification_locked` 2종뿐 |
| 임포트 저장 | `DefectManagementImportContext.tsx:349` | `upsert(onConflict: source_issue_no)` — 전 컬럼 덮어씀 |

## 변경 1 — 편집 가능 필드 확대 (UI)
`columns.ts`의 아래 자동채움 텍스트 필드에 `editable: true, editorType: "text"` 부여:

`classification`, `category`, `defect_type`, `item`,
`location_raw`, `defect_location`, `location_reference`, `podium_area`,
`building`, `room`, `level_name`,
`plan_title`, `plan_group`, `trade_detail`, `assigned_to`

제외(유지): 감사 필드(`created_*`, `updated_by_name`, `last_updated_at`), 참조번호(`ir`, `forms`),
그리고 순수 계산 배지 `start_status`(별도 저장 컬럼이 없어 편집 대상 아님 — 필요 시 별건 처리).

서버 `ALLOWED_FIELDS`(`mutations.functions.ts:11`)에 이미 대부분 포함되어 있으며,
누락분(`podium_area` 등 확인 후)만 추가한다.

## 변경 2 — 서버 권한을 역할 규칙과 동일화
`mutations.functions.ts`의 `assertAdmin`을 `assertCanEditRow`로 교체:

1. `has_role`로 rank 산출 → `senior_user` 이상이면 전체 허용
2. `d_superuser`는 대상 행의 `team`과 본인 `profiles.team` 일치 시 허용
3. `user`는 대상 행의 `hdec_pic_name`/`hdec_eng_name`/`subcontractor_name`/`subsub_name` 중
   하나가 본인 프로필 값과 일치할 때 허용
4. 그 외 거부. QAQC 제한 사용자(`isQaqcRestricted`)는 항상 거부

`updateDefectField`, `bulkUpdateDefects`, `bulkToggleCritical`은 동일 판정을 사용하고,
`bulkDeleteDefects`는 현행대로 admin/superuser 전용 유지.

## 변경 3 — 수동값 보존 (설계 변경 · 승인 필요)
`defect_items_raw`에 `manual_locked_fields text[] not null default '{}'` 컬럼 추가.

- 인라인/일괄 편집으로 위 필드를 저장하면 해당 컬럼명을 배열에 추가
- `BEFORE UPDATE` 트리거가 `manual_locked_fields`에 든 컬럼은 항상 `OLD` 값을 유지
  → 임포트 대량 upsert, 분류기 재계산, AI 분류 모두 자동으로 우회됨(호출부 수정 불필요)
- 셀에 잠금 아이콘 표시 + 팝오버에 "자동값으로 되돌리기"(배열에서 제거) 버튼 제공

## 기술 메모
- 마이그레이션: 컬럼 추가 + `BEFORE UPDATE` 트리거 함수(잠긴 컬럼 OLD 유지, `manual_locked_fields` 자체 변경은 통과)
- 임포트 경로는 무수정. 트리거가 단일 방어선
- 영향 파일: `columns.ts`, `mutations.functions.ts`, `EditCellPopover.tsx`, `DefectRawDataPage.tsx`, `BulkEditBar.tsx`
- 검증: user/d_superuser 계정으로 허용 행·비허용 행 각각 저장 시도, 잠금 필드가 재임포트 후 유지되는지 실측
