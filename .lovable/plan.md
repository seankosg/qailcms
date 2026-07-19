## 목표

TM 임포트를 HDEC PIC 기준으로 필터링. Admin은 기존과 동일하게 전권(필터 없음, 스코프 UI 미노출). Super User(superuser/d_superuser)는 컬럼매핑 버튼 옆 스코프 셀렉트로 "본인 항목만"(기본) / "Super User: 전체 임포트" 선택 가능. 그 외 사용자는 항상 본인 HDEC PIC 항목만.

## 사용자 등급별 동작

- **Admin (`isAdmin`)**: 기존과 동일. 스코프 UI 미노출, 필터 미적용, 전체 임포트.
- **Super User (`isSuperUser` 또는 `isDSuperUser`, admin 아님)**: 스코프 Select 노출. 기본 "본인 HDEC PIC 항목만", 필요 시 "전체" 선택 가능.
- **그 외 (senior_user, user 등)**: 스코프 고정 "본인 HDEC PIC 항목만"(읽기 전용 배지). 임포트 버튼 활성화 조건은 매칭 행이 1건 이상.

## 매칭 로직

- 사용자 키: `useCurrentUser().hdec_pic_name`
- 행 키: `ParsedTaskRow.hdec_pic_name`
- 비교: 양쪽 `trim().toLowerCase()` 완전일치
- 사용자 `hdec_pic_name`이 비어 있고 스코프가 `mine`이면 매칭 0건 → Start 비활성 + 툴팁 안내
- 마스터 매핑 미해결 상태에서는 필터에서 탈락할 수 있으므로 상단 MasterMappingSection 해결을 유도하는 안내 문구 추가

## UI 변경 (`TaskManagementImportPage.tsx`)

- Files 카드 툴바(Clear all / Start import) 좌측 또는 컬럼매핑 다이얼로그 트리거 옆 영역에 스코프 선택 컨트롤 배치.
  - Admin: 렌더 안 함.
  - Super User: `Select` — `mine` / `all`.
  - 일반 사용자: 뱃지 "본인 HDEC PIC 항목만".
- 파일 행에 "임포트 대상 N / 파싱 M" 카운트 표시(스코프 반영).
- Start 버튼 게이트를 `isEditor` 이상 + 총 매칭 행 ≥ 1 로 완화(Admin은 기존처럼 총행 ≥ 1).

## 컨텍스트 변경 (`TaskManagementImportContext.tsx`)

- 상태 추가: `importScope: "mine" | "all"`, 기본 `"mine"`, `setImportScope`.
- Provider 마운트 시 현재 사용자 프로필의 `hdec_pic_name`, 역할 플래그(`isAdmin`, `isSuperUserLike`)를 로드해 캐시.
- 효과적 스코프 계산: `isAdmin ? "all" : (isSuperUserLike ? importScope : "mine")`.
- `executeImport` 진입 시 각 파일 `parsed`를 효과적 스코프로 필터링, 롤업/부모-자식 카운트를 재계산 후 진행.
  - 필터로 인해 부모 없는 자식이 남을 경우 스킵하고 `skipped_orphan_after_scope` 집계.
  - 필터 결과 카운트, 원본 카운트, 스코프를 import 로그 `note`에 요약 기록.
- Preflight 대상도 필터링된 rows로 실행하여 충돌 판정을 일관되게 유지.

## 산출물

- `src/components/task-management/import/TaskManagementImportPage.tsx`
- `src/contexts/TaskManagementImportContext.tsx`

SM/ABD/Spare Part 임포트에는 영향 없음.
