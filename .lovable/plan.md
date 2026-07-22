## 목표
앱 전체의 사용자 노출 날짜 표시 형식을 아래 규칙으로 통일합니다.
- 긴 형식: `yyyy-mm-dd` → `dd-MMM-yyyy` (예: `22-Jul-2026`)
- 짧은 형식: `dd-MMM` 또는 `dd-MMM-yy` (예: `22-Jul`, `22-Jul-26`)

DB에 저장되는 ISO 값(`YYYY-MM-DD`, `timestamptz`)과 파일명용 타임스탬프(`dohaStampCompact`)는 그대로 유지합니다. 변경 대상은 **UI 표시 문자열**과 엑셀 셀 표시값만입니다.

## 구현 방식

### 1. 공통 포매터 신설 (`src/lib/time/doha.ts`)
아래 헬퍼를 추가하여 앱 전역이 단일 소스에서 포맷팅하도록 만듭니다.
- `formatDdMmmYyyy(input)` → `22-Jul-2026` (긴 형식, 기본)
- `formatDdMmm(input)` → `22-Jul` (짧은 형식, 연도 생략)
- `formatDdMmmYy(input)` → `22-Jul-26` (짧은 형식, 2자리 연도)
- `formatDdMmmYyyyHm(input)` → `22-Jul-2026 14:30` (기존 `dohaDateTime` 대체용, 필요 지점에서만)

모두 도하 타임존 기준으로 계산하며, 잘못된 값은 빈 문자열을 반환합니다.

### 2. 기존 로컬 포매터 통합
현재 프로젝트에는 동일 목적의 포매터가 파일별로 흩어져 있습니다. 모두 위 공통 헬퍼로 교체합니다.
- `src/lib/defect-management/stage-utils.ts` → `formatDdMmm`
- `src/lib/spare-part/format.ts` → `formatDdMmm`
- `src/components/task-management/raw-data/TaskStageProgress.tsx` → 내부 `fmtDdMmm`
- 기타 컴포넌트에서 `toLocaleDateString`, `slice(0,10)`, `date-fns/format` 로 직접 만드는 곳

### 3. 교체 대상 스캔 규칙
빌드 모드 진입 후 다음 패턴을 정적 검색으로 훑어 후보를 뽑고, UI 표시 문자열만 교체합니다.
- `toLocaleDateString(` — 사용자 표시 문자열 대부분
- `\.slice\(0,\s*10\)` — 표시 목적으로 ISO 앞 10자만 잘라 쓰는 곳
- `date-fns` `format(` 호출 중 `yyyy`, `yyyy-MM-dd`, `PPP`, `MMM d, yyyy` 등
- 커스텀 `fmt*Date`, `formatDate`, `fmtDdMmm` 등의 로컬 헬퍼

DB 저장/전송/파일명/HTML `<input type="date">` value 는 제외합니다 (아래 §5).

### 4. 페이지·컴포넌트 표시 지점 (대표)
- Raw Data 테이블 (SM/TM/ABD/DMR/Spare Part) 의 날짜 셀
- 상세 시트/페이지의 필드 값
- 대시보드 KPI 카드, 매트릭스 헤더/툴팁, S-Curve 축 라벨
- Task Tree 미니 차트 툴팁, Progress Chart Dialog 축·툴팁
- Data Date Picker 트리거 라벨, DatePicker 트리거
- Import Log 매트릭스 헤더(날짜 컬럼 축약형은 짧은 형식 사용)
- 댓글 타임스탬프 (`formatDdMmmYyyyHm`)
- 엑셀 내보내기 셀 값(파일명은 유지)

각 지점에서 자연스러운 표시 폭을 위해 다음 원칙을 적용합니다.
- 단일 날짜 필드/툴팁: 긴 형식(`dd-MMM-yyyy`)
- 매트릭스 컬럼 헤더, 차트 축, 좁은 셀 배지, 스테이지 배지 부제: 짧은 형식(`dd-MMM`)
- 여러 해가 섞이는 축(장기 S-Curve 등): 필요 시 `dd-MMM-yy`

### 5. 변경 제외 항목 (중요)
아래는 그대로 유지합니다.
- Supabase 저장/RPC 파라미터: 계속 ISO(`YYYY-MM-DD`) 사용
- `<input type="date">` value/onChange 인자
- 파일명 타임스탬프: `dohaStampCompact` (`YYYYMMDD-HHmm`)
- URL 쿼리 파라미터 `dataDate`
- 임포트 파서의 문자열 파싱 규칙(입력측 인식): 기존 로직 유지, 표시측만 재포맷

### 6. 검증
- `rg` 로 남은 `toLocaleDateString`, `slice(0, 10)` 표시 용도 잔여 검색
- 대표 페이지 5곳(SM Raw Data, TM Task Tree, ABD Dashboard, DMR Dashboard, Task Detail)에서 표시 확인
- 엑셀 export 파일 1개 열어 셀 표시 확인
- 빌드/타입체크 통과 확인

## 세부 기술 항목
- 월 이름은 `en-US` locale의 `short` (`Jan`~`Dec`) 사용.
- 도하 타임존 처리는 기존 `shiftToDoha` 흐름을 그대로 재사용하여 UTC↔로컬 왜곡을 방지.
- 기존 심볼(`formatDdMmm` 등)은 유지하되 내부 구현만 새 헬퍼에 위임하여 호출부 breaking change 없이 마이그레이션.

## 확인 필요
1. 짧은 형식에서 **연도가 다른 해로 넘어가는 경우** 자동으로 `dd-MMM-yy`로 보강할까요, 아니면 짧은 형식은 항상 `dd-MMM`으로 두고 필요한 곳만 개별적으로 `dd-MMM-yy`를 명시할까요?
2. 날짜+시간 표시(댓글, 상태 이력, `created_at`/`updated_at` 감사 컬럼)의 시간 부분은 현행 `HH:mm`(24시간) 유지로 진행해도 될까요?
