
# 다음 작업 계획

사용자 선택에 따라 **프로필 정비 → 코드 배포** 순서로 진행합니다.  
현재 배포된 DB 스키마·트리거·헬퍼 함수(`owner_user_id`, `is_full_access`, `is_row_owner`, `resolve_owner_by_name`, 4개 도메인 트리거)는 그대로 유지합니다.

---

## Phase 1 — 프로필/마스터 데이터 정비 (사용자 주도 + 관리자 UI 지원)

### 1.1 관리자용 사용자 편집 UI 확장 — `src/routes/_authenticated/admin/users.tsx`
- **user_type 옵션 확장**: `hdec_pic`, `hdec_eng`, `subcontractor`, `subsub` 노출 (superuser/d_superuser/admin/senior_user/user 포함)
- **역할별 이름 필드**:
  - `hdec_pic` 선택 시 → `hdec_pic_name` 입력 활성화 (예: `KR NA_나경락`)
  - `hdec_eng` 선택 시 → `hdec_eng_name` 입력 활성화
  - `subcontractor` 선택 시 → `subcontractor_name` 입력 (예: `ALUTEC`, `ASBL`, `FANAR` …)
  - `subsub` 선택 시 → `subsub_name` 입력
- **검증**: 이름 값 중복 등록 시 경고 (동일 이름 2명 이상이면 `resolve_owner_by_name`이 매칭 불가로 처리됨을 안내)

### 1.2 프로필 백필 지원 도구 (선택적)
- 관리자 페이지 상단에 "미등록 이름 후보" 섹션 추가
  - Defect의 `subcontractor_name` 34개 중 프로필에 없는 회사코드 리스트업
  - ABD의 `pic` 61개 인력명 리스트업 → (별도 필드 신설 예정, 우선 참고용)

### 1.3 사용자가 프로필 등록 완료 후
- 트리거는 이미 INSERT/UPDATE에 걸려 있으므로, `UPDATE raw SET updated_at = updated_at WHERE owner_user_id IS NULL` 같은 재계산 유틸 버튼 제공(관리자 페이지) 또는 별도 서버 fn 제공하여 owner_user_id 재백필 실행

---

## Phase 2 — ABD Raw Data에 HDEC PIC/ENG 컬럼 신설

### 2.1 DB 스키마 변경 (`supabase--migration`)
- `abd_items_raw` 테이블에 컬럼 추가:
  - `hdec_pic_name text`
  - `hdec_eng_name text`
- 인덱스: `idx_abd_hdec_pic_name`, `idx_abd_hdec_eng_name`
- ABD owner 트리거 재작성: `pic` 대신 `hdec_pic_name → hdec_eng_name → pic(fallback)` 우선순위

### 2.2 임포트 파서/설정 확장
- `src/lib/abd/parser.ts`: `HDEC PIC`, `HDEC ENG` 헤더 인식 추가
- `abd_field_config` 및 `abd_header_mappings` 시드에 새 필드 등록
- Raw Data 페이지 컬럼 빌더에 두 컬럼 추가 (기본 노출)

---

## Phase 3 — 서버/클라이언트 권한 코드 구현 (이전 계획에서 이어짐)

프로필 정비가 어느 정도 완료된 후 진행합니다.

### 3.1 `src/types/enums.ts`
- `UserType`에 `hdec_pic`, `hdec_eng` 추가
- `ROLE_RANK`: `superuser(90) > d_superuser(80) > senior_user(70) > user(60) > hdec_pic/hdec_eng/subcontractor/subsub(50) > viewer(10)`

### 3.2 `src/lib/auth/roles.ts`
- `isFullAccess(profile)`: `admin || superuser || d_superuser` (senior_user 제외)
- `isOwnerOfRow(profile, row, tableKind)`: 
  - 우선 `row.owner_user_id === profile.id`
  - fallback: 테이블별 이름 컬럼과 프로필 이름 매칭
- `canEditRawRow`, `canDeleteRawRow`, `canImportRow` 신규/재작성

### 3.3 서버 fn 재검증
- ABD/Defect/Spare Parts/Task 4개 도메인의 `mutations.functions.ts`:
  - 기존 `assertAdmin`을 `assertCanEditRawRow` / `assertCanImportRow`로 교체
  - `is_full_access(auth.uid())` 또는 `is_row_owner(...)` DB 함수 호출로 판정
- Bulk update/delete: 각 행별 소유권 재검증, 위반 시 `403`

### 3.4 Import Context 4종
- 업로드 시 owner 범위 밖 행 자동 스킵 + `rejected` 로그에 `"not_owner"` 사유 기록
- `d_superuser/admin/superuser`는 전체 업로드 허용

### 3.5 UI 비활성화 처리
- Raw Data 페이지의 인라인 편집·행 삭제 버튼: 비소유 행일 때 비활성화 + 툴팁 "본인 소유 행만 편집 가능"

---

## 즉시 실행 여부

`Phase 1.1`(관리자 UI 확장)부터 코드 작업에 착수합니다. 승인 시 진행합니다.
