## 목표
`hdec_pic_master` / `hdec_eng_master` 두 마스터 테이블을 제거하고, `profiles`를 단일 원천으로 삼아 세 곳을 하나로 통합합니다. 모든 HDEC PIC / HDEC ENG는 반드시 시스템 사용자(profiles + auth.users)로만 존재합니다.

## 최종 구조

```text
                 profiles (단일 원천)
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 사용자관리 UI   HDEC PIC 뷰    HDEC ENG 뷰
                (user_type=hdec) (user_type=pm_pd)
                     │              │
                     └──── 드롭다운 옵션 공급 ────┘
```

## 변경 사항

### 1. 데이터베이스 마이그레이션
- 기존 `hdec_pic_master`, `hdec_eng_master` 참조 정리 후 두 테이블 **DROP**.
- 대체 뷰 2개 생성 (기존 이름 그대로 → 앱 코드 최소 수정):
  - `hdec_pic_master` 뷰 = `SELECT id, name, is_active, created_at, updated_at FROM profiles WHERE user_type='hdec' AND is_active=true`
  - `hdec_eng_master` 뷰 = `SELECT id, name, is_active, created_at, updated_at FROM profiles WHERE user_type='pm_pd' AND is_active=true`
  - `name`은 `COALESCE(name, display_name, login_id)`로 안전 처리.
- 뷰에 `authenticated`용 `GRANT SELECT` 부여 (RLS는 profiles 정책이 이미 통제).
- `profiles.hdec_pic_name` / `hdec_eng_name` 컬럼은 현재 사용자 자기 참조가 아니라 "담당 PIC/ENG 지정" 용도이므로 **유지** (다른 user_type에서 담당자 지정에 사용).

### 2. 관리자 UI 정리 (`src/routes/_authenticated/admin/masters.tsx`)
- **HDEC PIC / HDEC Eng 탭 제거**. Subcontractor / Sub-Sub / Team 탭만 유지.
- 사용자관리 화면 상단 안내 문구 추가: "HDEC PIC / HDEC ENG 명단은 [사용자관리]에서 관리됩니다."
- `SimpleMasterTab`, 관련 mutation 코드 제거.

### 3. 옵션 훅 (`src/hooks/useMasterOptions.ts`)
- 뷰 이름이 그대로여서 쿼리 코드는 변경 없이 동작. 타입만 확인.

### 4. 서버 함수 (`src/lib/admin/users.functions.ts`)
- `MasterKind`에서 `hdec_pic` / `hdec_eng` 케이스 제거 (마스터 CRUD 서버 함수가 이들을 다루지 않도록).
- 사용자관리 화면의 PIC/ENG 드롭다운은 뷰(`hdec_pic_master`, `hdec_eng_master`)를 그대로 읽음 → 사용자 저장 시 마스터가 자동 갱신됨.

### 5. 사용자관리 화면 (`src/routes/_authenticated/admin/users.tsx`)
- `useMasterList("hdec_pic" | "hdec_eng")`는 뷰를 읽으므로 그대로 동작. 코드 변경 최소.

## 마이그레이션 시 리스크 / 사전 처리
- 두 마스터 테이블은 현재 **0건**이므로 데이터 손실 없음.
- 앱의 defect/task 임포트 매핑에서 마스터 테이블을 **INSERT/UPDATE** 하는 경로가 있는지 확인 필요 (뷰는 write 불가). 검색 결과상 이미 profiles 이름을 문자열 저장 방식이라 write 경로 없음 — 마이그레이션 전에 grep으로 최종 확인 후 진행.
- Supabase 타입(`types.ts`)이 자동 재생성되므로 컴파일 오류 여부를 마이그레이션 승인 후 재점검.

## 결과
- 관리 화면에서 "HDEC PIC/ENG 마스터" 탭 사라짐.
- 사용자관리에서 hdec/pm_pd 사용자를 만들면 즉시 PIC/ENG 드롭다운에 나타남.
- 사용자를 비활성화하면 드롭다운에서 자동 제외.
- 세 항목이 하나의 원천(profiles)으로 통합 완료.