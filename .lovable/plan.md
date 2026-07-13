## 목표

앱 전체의 사용자 노출 문구를 중동 프로젝트 관례에 맞춰 **Defect → Snag** (정식 명칭은 **Snag List**)로 교체합니다. URL 라우트도 `defect-management` → `snag-management`로 변경합니다. DB 테이블·컬럼·함수와 내부 코드 식별자(컴포넌트/훅/타입/파일명)는 리스크 최소화를 위해 **그대로 유지**합니다.

## 변경 범위 요약

| 층위 | 변경 | 예시 |
|---|---|---|
| UI 문구 | ✅ 전면 | "Defect Management" → "Snag List Management", "Defect Raw Data" → "Snag List — Raw Data", "Defect Item" → "Snag Item", 배지/툴팁/토스트/에러메시지/버튼 라벨/설정 페이지 설명 등 |
| `<title>` / head meta | ✅ 전면 | 각 route의 `head()` title 및 og:title/description |
| URL 경로 | ✅ 변경 | `/closure/defect-management/*` → `/closure/snag-management/*` |
| 사이드바/네비게이션 | ✅ | AppLayout 메뉴 라벨 및 `to=` 경로 |
| 라우트 파일명 | ✅ 폴더 이름만 변경 | `src/routes/_authenticated/closure/defect-management/` → `.../snag-management/`, 내부 `createFileRoute("...")` 문자열도 새 경로에 맞춰 갱신 |
| 코드 식별자 | ❌ 유지 | 컴포넌트명(`DefectRawDataPage`), 훅(`useDefectItems`), 타입(`DefectTeam`), 파일 폴더(`src/components/defect-management/`, `src/lib/defect-management/`), 상수(`DEFECT_COLUMNS`, `DEFECT_TEAMS`) 전부 그대로 |
| DB | ❌ 유지 | `defect_items_raw`, `defect_import_logs`, `rollback_defect_import` 등 60+ 식별자 전부 그대로. 마이그레이션 없음 |
| Aconex/LetsBuild 등 외부 시스템 헤더 매핑 | ❌ 유지 | 외부에서 "Defect No." 등으로 오는 원본 컬럼 라벨은 그대로 (매핑 소스라 임의 변경 시 import 깨짐) |

## 상세 작업

### 1. 라우트 리네이밍 (URL + 파일)
`src/routes/_authenticated/closure/defect-management/` 아래 5개 파일을 `snag-management/`로 이동:
- `import.index.tsx`, `import.logs.tsx`, `raw-data.tsx`, `settings.tsx`, `detail.$id.tsx`

각 파일의 `createFileRoute("/_authenticated/closure/defect-management/...")` 문자열을 `.../snag-management/...`로 갱신. `routeTree.gen.ts`는 dev 서버가 자동 재생성.

### 2. 네비게이션·링크 갱신
- `src/components/layout/AppLayout.tsx`: 사이드바 메뉴 라벨 "Defect Management" → "Snag List Management", `to` 경로 갱신
- 코드 전역의 `<Link to="/closure/defect-management/...">` 및 `navigate({ to: "..." })` 문자열을 `snag-management`로 일괄 치환
- `src/lib/defect-management/columns.ts`의 상세 페이지 링크 빌더 등에서도 경로 갱신
- `.gen.ts`는 자동 재생성되지만, 타입체크 통과 확인 필요

### 3. UI 문구 치환 규칙
사람 눈에 보이는 곳(JSX 텍스트, 문자열 리터럴 중 라벨/제목/설명·`toast.*`·`title=`·`placeholder=`·`aria-label`·`<meta>` content 등)에서만 다음 규칙 적용:

- "Defect Management" → **"Snag List Management"**
- "Defect Raw Data" → **"Snag List — Raw Data"**
- "Defect Settings" → **"Snag List Settings"**
- "Defect Detail" → **"Snag Detail"**
- "Defect Item(s)" → **"Snag Item(s)"**
- 단독 "Defect" (문장 내) → **"Snag"**
- 한국어 "결함" 표기가 있다면 → **"스낵(Snag)"** (첫 등장 시 병기, 이후 "Snag")

**치환하지 않는 곳**:
- 코드 식별자 (변수/함수/타입/파일명/import 경로)
- DB 컬럼·테이블·RPC 이름
- 외부 시스템 원본 헤더 문자열(`"Defect No."`, `"Defect Description"` 등 Aconex/LetsBuild 파일에서 오는 헤더 매칭 키) — parser/mapping 로직 내부
- 이미 생성된 마이그레이션 SQL 파일

### 4. head/meta 갱신
각 route의 `head()` 내 `meta[title]`, `og:title`, `og:description`을 새 문구로 교체. 예: `"Defect Management — Import Logs"` → `"Snag List — Import Logs"`.

### 5. 검증
- `bunx tsgo --noEmit` 통과
- 사이드바에서 "Snag List Management" 클릭 → `/closure/snag-management/raw-data` 이동 확인
- `/closure/snag-management/import`, `/import/logs`, `/settings`, `/detail/:id` 모두 정상 렌더링
- 기존 `/closure/defect-management/*` 북마크는 404 처리됨 (사용자에게 안내). 필요 시 후속 이슈로 redirect 추가 가능.

## 리스크 및 주의

- **북마크/외부 링크 깨짐**: 기존 `/closure/defect-management/*` URL은 더 이상 매칭되지 않음. 사내 배포 초기라면 수용 가능하지만, 필요 시 이 계획 승인 후 별도 turn에서 리다이렉트 라우트 추가 가능.
- **외부 파일 헤더 문자열**: Aconex/LetsBuild import 파일 컬럼명(`"Defect No."` 등)은 외부 시스템 산출물이라 UI 텍스트가 아니라 매칭 키. 절대 변경 금지 (import 실패 원인).
- **DB·코드 식별자 미변경**: 개발자가 코드를 열면 `defect_*`가 남아있음. 사용자에게는 완전히 Snag로 보이지만 유지보수 시 이 이중 명명 규칙을 인지해야 함.
- **`routeTree.gen.ts`**: 수동 편집 금지. dev 서버 재시작 시 자동 재생성됨.

## 산출물
- 5개 route 파일 rename + `createFileRoute` 경로 문자열 갱신
- UI 문구/head/링크 경로 치환 (약 40~50개 컴포넌트·페이지 파일)
- DB·코드 식별자·마이그레이션·외부 헤더 매핑은 무변경
