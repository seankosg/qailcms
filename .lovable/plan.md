## 개요

사이드바에 신규 최상위 섹션 **Resource**를 추가하고, 하위에 **DMR (Daily Manpower Report)** 모듈을 SHAW의 DMR 모듈 컴포넌트/UX를 참조하여 이식합니다. 유첨 3장(ARCH / ELECT / Mech)의 실제 데이터 구조에 맞춰 스키마·파싱·대시보드를 새로 설계합니다.

---

## 1. 사이드바 & 라우팅

`src/components/layout/AppLayout.tsx` NAV에 신규 섹션 추가 (Close-Out Doc 아래, Admin 위):

```text
Resource
  Dashboard        /resource/dashboard
  DMR
    Dashboard      /resource/dmr/dashboard
    Raw Data       /resource/dmr/raw-data
    Import         /resource/dmr/import
```

접근 권한: 모든 인증 사용자 조회, `senior_user` 이상 임포트/편집(TM/SM 정책 준수). 라우트는 `_authenticated/` 하위.

---

## 2. 데이터 스키마 (롱포맷)

새 테이블 3종을 마이그레이션으로 신설. 모두 `public.` GRANT 포함.

**`dmr_system_master`** — System 마스터
- `id uuid pk`, `discipline text check in ('ARCH','ELECT','MECH')`, `name text`, `sort_order int`, `is_active bool default true`, timestamps
- unique(discipline, name)

**`dmr_contractor_master`** — Contractor 마스터
- `id uuid pk`, `name text unique`, `is_direct bool default false` (직영/협력사), `discipline_hint text[]` (참고용), timestamps
- 기존 `subcontractor_master`와 별도(도메인 분리, 유형·개념 다름).

**`dmr_entries`** — 인원 실적 (롱포맷)
- `id uuid pk`
- `report_date date not null`
- `discipline text check in ('ARCH','ELECT','MECH')`
- `system_name text not null` (조회 편의를 위해 비정규화, 마스터 id 별도 컬럼)
- `system_id uuid null references dmr_system_master(id)`
- `contractor_name text not null`
- `contractor_id uuid null references dmr_contractor_master(id)`
- `plot text check in ('C','D','TOTAL') not null`
- `metric text check in ('target','today','yesterday') not null`
- `manpower int not null default 0`
- `source_image_path text`, `created_by uuid`, `created_at`, `updated_at`
- unique(report_date, discipline, system_name, contractor_name, plot, metric)
- 인덱스: (report_date desc), (discipline, report_date), (contractor_name, report_date)

`difference`는 저장하지 않고 앱에서 `today − yesterday`로 실시간 계산. `Total`은 이미지에 명시된 값을 그대로 저장(합계 검증만 수행하고 강제 재계산은 하지 않음 — 이미지 원본 무결성 유지).

RLS: authenticated select all, senior_user+ insert/update/delete (기존 `has_role` 활용).

Storage 버킷 `dmr-uploads`(private) 신설, senior_user+ upload/read 정책.

---

## 3. 이미지 파싱 (AI Gateway)

TanStack 스택이므로 **Supabase Edge Function 대신** `createServerFn`으로 구현.

**`src/lib/dmr-parse.functions.ts`** — `parseDmrImages`
- `.middleware([requireSupabaseAuth])` (senior_user+ 체크)
- 입력: `{ storagePaths: string[] }` (1~3장)
- 각 이미지에 signed URL 발급 → Lovable AI Gateway `google/gemini-3.1-flash-image`(비전) 호출 → 구조화된 JSON 반환
- 응답: `ParsedDmr[]` — discipline별 섹션, System×Contractor 행별 Plot(C/D/Total)×Metric(Target/Today/Yesterday) 12개 수치

**AI System Prompt 요지** (`src/lib/dmr-prompt.server.ts`):
- 헤더 "SUMMARY OF DAILY MANPOWER MOBILIZATION STATUS" + 우측 상단 report_date(YYYY.MM.DD)
- discipline: 이미지 제목 (ARCH / ELECT / MECH) 자동 감지
- 행: System(1열) + Contractor Subcon.(2열) + Target/Today/Yesterday 각각 Plot C / Plot D / Total (총 9 수치, Difference는 무시)
- 빈칸/`-`은 0, 콤마 제거
- 검산: (C + D) === Total 이면 신뢰, 어긋나면 warning으로 기록하되 원본 값 보존
- 마지막 "Grand Total"/"Sub Total" 행은 rows에서 제외하고 별도 필드로 반환

Zod 스키마로 응답 검증, 실패 시 원본 이미지에 대해 `AI_NoObjectGeneratedError` 안전 폴백.

---

## 4. Import 페이지 UX

**`/resource/dmr/import`** — SHAW `DmrImportPage` 참조하되 3장 병렬 처리로 재구성.

레이아웃:
1. **Report Date**: 자동 감지 값을 상단에 노출, 사용자 수정 가능. 3장 모두 같은 날짜여야 함 (mismatch 시 경고 + 수동 통일 옵션).
2. **파일 슬롯 3개**: ARCH / ELECT / MECH 각각. 드래그·드롭 또는 파일 선택. discipline은 파일 슬롯으로 강제(AI 감지값과 다르면 경고).
3. **Parse 버튼** → 3장 병렬 파싱 → 각 섹션별 편집 가능한 프리뷰 테이블 표시.
4. **프리뷰 편집**: SHAW와 동일하게 셀 단위 수정 가능. Difference(today − yesterday) 자동 계산 컬럼 표시(저장 X).
5. **마스터 동기화 다이얼로그**:
   - Contractor: `dmr_contractor_master`에 없는 이름은 신규 등록 여부 확인. 편집거리 ≤2 유사 매칭 시 SHAW `SimilarMasterDialog` 재사용해서 "기존 사용/신규 등록" 선택.
   - System: 동일 로직으로 `dmr_system_master` 대상.
   - 신규 등록 시 `is_direct` 체크박스(Contractor만).
6. **덮어쓰기 옵션**: 같은 (report_date, discipline, system, contractor, plot, metric) 존재 시 overwrite 토글.
7. **Save**: 롱포맷으로 flatten → 배치 upsert.

Import 로그: `dmr_import_logs`(스키마는 기존 `abd_import_logs` 스타일 축약본) — 이번 계획에는 표만 만들고 상세 뷰는 다음 라운드로 미룸.

---

## 5. Raw Data 페이지

**`/resource/dmr/raw-data`** — 기존 ABD/SM Raw Data 패턴 준수.
- 서버 페이징 + 텍스트 컬럼 드롭다운 필터(discipline, system_name, contractor_name, plot, metric).
- 상단 요약 뱃지: 선택 기간 인원 합계, 협력사/직영 구분.
- 컬럼: Report Date, Discipline, System, Contractor, Direct(뱃지), Plot, Metric, Manpower.
- 편집: senior_user+ 인라인 편집. 삭제는 d_superuser+.
- Import 진입 버튼 + Excel 내보내기(기존 `exportSnagRaw` 스타일 재사용).

---

## 6. Dashboard 페이지

**`/resource/dmr/dashboard`** — SHAW `DmrDashboardPage` + Punch KPI 카드 스타일 혼합.

상단 필터 바:
- Data Date Picker (기본: 최신 report_date)
- Discipline 토글 (All / ARCH / ELECT / MECH)
- 유형 토글 (All / 직영 / 협력사)

카드/차트 구성:
1. **KPI 스트립** — 오늘 총원, 어제 총원, Δ, Target 총원, 달성률(Today/Target%)
2. **Discipline별 요약 카드 3개** — 각 ARCH/ELECT/MECH: today, yesterday, target, Δ
3. **Contractor × 일자 매트릭스(피벗)** — 최근 7/14/30일 선택. 행: Contractor, 열: 일자, 값: today 합계. SHAW 매트릭스와 동일 UX.
4. **일자별 총원 라인 차트** — Today vs Target(계획선), 최근 30일
5. **Target vs Actual 갭 카드** — Discipline별 오늘 대비 Target 잔여

모두 클릭 시 Raw Data로 딥링크(필터 리셋 + 해당 조건 적용, 기존 SM/ABD 패턴 준수).

---

## 7. 파일 목록 (신규)

- `supabase/migrations/<ts>_create_dmr_module.sql` — 3개 테이블 + GRANT + RLS + 인덱스 + 스토리지 버킷
- `src/routes/_authenticated/resource/dashboard.tsx` (섹션 대시보드 간단 링크 페이지)
- `src/routes/_authenticated/resource/dmr/dashboard.tsx`
- `src/routes/_authenticated/resource/dmr/raw-data.tsx`
- `src/routes/_authenticated/resource/dmr/import.tsx`
- `src/components/resource/dmr/DmrDashboardPage.tsx`
- `src/components/resource/dmr/DmrRawDataPage.tsx`
- `src/components/resource/dmr/DmrImportPage.tsx`
- `src/components/resource/dmr/DmrPreviewTable.tsx`
- `src/components/resource/dmr/DmrContractorMatrix.tsx`
- `src/lib/dmr-parse.functions.ts` (`parseDmrImages`)
- `src/lib/dmr-import.functions.ts` (`saveDmrEntries`, `listSimilarMasters`)
- `src/lib/dmr-prompt.server.ts` (AI System Prompt 상수)
- `src/lib/dmr/types.ts` (`ParsedDmr`, `DmrEntryRow` 등)
- `src/lib/dmr/utils.ts` (flatten, difference 계산, 검산)
- `src/components/layout/AppLayout.tsx` (NAV 추가)

---

## 8. 범위 제외 (다음 라운드)

- DMR Import Log 상세 페이지(파일 히스토리 뷰)
- Productivity(Nos/Man): SM/TM Raw와 조인 필요 → 별도 스코프
- 엑셀(.xlsx) 임포트 병행: 요청 시 추가

---

## 확인이 필요한 마지막 항목

1. **초기 마스터 시드**: 유첨 3장에 나타난 System/Contractor 값을 마이그레이션에서 시드 데이터로 미리 넣어둘까요? (권장) 아니면 첫 임포트 시 자동 생성만 사용?
2. **Plot 이름**: 이미지는 `Plot C` / `Plot D`. 프로젝트 명명이 향후 확장될 수 있다면 마스터로 뺄까요, 아니면 지금은 하드코딩(C/D/TOTAL) 유지?

이 두 항목만 확인해주시면 승인 후 바로 구현하겠습니다.
