## 목표
`src/components/layout/AppLayout.tsx`의 사이드바를 시인성 높고 세련되게 재디자인한다. 아이콘은 **실제 3D 렌더링 아이콘팩**을 도입하고, 데스크톱에서 사이드바를 접어 본문 폭을 넓힐 수 있는 토글을 추가한다.

## 현재 상태 (확인 완료)
- 사이드바는 `AppLayout.tsx`에서 직접 구현 (shadcn `Sidebar` 미사용). 고정 폭 `w-64`, `lg:pl-64`로 본문 여백 확보, 모바일은 오버레이.
- 아이콘은 `lucide-react` 2D 아웃라인.
- 섹션: My Work Space / Outstanding Work / Close-Out Doc / Resource / Import & Log / Admin. 모듈 그룹 펼침 상태는 localStorage 저장.

## 1. 3D 아이콘 도입 (Option B)

### 아이콘팩 선택
- **`3dicons` 무료 팩** (3dicons.co, MIT 라이선스, PNG/SVG 제공) 사용.
- 사이드바에서 사용되는 아이콘은 약 20개로 한정적이므로, npm 의존성 대신 필요한 아이콘의 **PNG(@2x, 투명배경)만 선별 다운로드**하여 `src/assets/nav-icons/`에 번들. 트리쉐이킹/용량 걱정 없음.
- 각 아이콘은 128×128 PNG, 사이드바에서는 `h-6 w-6`(펼침) / `h-7 w-7`(접힘)으로 표시.

### 매핑 (NAV 항목 → 3D 아이콘)
| 위치 | 현재 lucide | 3D 아이콘 |
|---|---|---|
| My Work Space | UserCircle2 | `user-3d.png` |
| Outstanding Dashboard / 각 섹션 Dashboard | LayoutDashboard | `dashboard-3d.png` |
| Task Management | ClipboardList | `clipboard-3d.png` |
| Snag List Management | AlertTriangle | `warning-3d.png` |
| As Built Drawing | FileSpreadsheet | `blueprint-3d.png` |
| Spare Part | Package | `box-3d.png` |
| Warranty & License | FileCheck2 | `certificate-3d.png` |
| DMR | HardHat | `helmet-3d.png` |
| Import | Upload | `upload-3d.png` |
| Import Logs | FileClock | `history-3d.png` |
| Admin Overview | LayoutDashboard | `settings-gear-3d.png` |
| 사용자 | Users | `people-3d.png` |
| 마스터 | Users | `database-3d.png` |
| Mapping | Settings2 | `link-3d.png` |
| Task 임계값 | Sliders | `slider-3d.png` |
| Task Summary | ListTree | `tree-3d.png` |
| Raw Data | Database | `table-3d.png` |
| Progress | TrendingUp | `chart-up-3d.png` |
| Schedule Revision | CalendarClock | `calendar-3d.png` |
| Aconex Sync | RefreshCw | `refresh-3d.png` |
| Settings (모듈 내) | Settings2 | `settings-gear-3d.png` |

빠진 항목은 3dicons 카탈로그에서 의미상 가장 근접한 것으로 채우고, 20개 내외로 최종 확정.

### 렌더 방식
- `NavIcon` 로컬 컴포넌트: `<img src={...} alt="" className="h-6 w-6 select-none pointer-events-none" draggable={false} />`.
- 활성 상태에서만 `drop-shadow-[0_2px_6px_rgba(var(--primary-rgb),0.35)]` + 살짝 scale(1.05) 강조 (Tailwind 클래스). 다크모드에서도 원본 3D 렌더 그대로 유지되므로 색 반전 없음.
- 헤더 로고/토글 등 사이드바 외부에는 계속 lucide 사용 (일관성 있게 사이드바 NAV에만 3D 적용).

## 2. 접기/펼치기 토글

- `sidebar-collapsed:v1` 로컬스토리지 키로 상태 저장, 데스크톱(`lg` 이상)에서만 동작. 모바일은 기존 오버레이 유지.
- 상태:
  - `expanded` (w-64): 현재 UI.
  - `collapsed` (w-16): 3D 아이콘만 표시, 라벨/뱃지/헤더 사용자 정보 숨김.
- 접힘 시:
  - 리프 항목: hover 시 Radix `Tooltip`으로 라벨 표시.
  - 모듈 그룹: 그룹 토글 대신 hover 시 `HoverCard`로 하위 리스트 팝업.
  - 섹션 라벨: 아이콘만 있는 얇은 divider로 대체.
- 토글 버튼:
  - `TopBrandHeader` 좌측에 `PanelLeft` / `PanelLeftClose` 아이콘 버튼 상시 노출.
  - `aria-expanded`, `aria-controls="app-sidebar"` 설정. `[` / `]` 키보드 단축키 지원.
- 본문 여백: `cn("lg:pl-64", collapsed && "lg:pl-16")` + `transition-[padding] duration-200`. `prefers-reduced-motion` 대응.

## 3. 시각 시스템 개편 (사이드바 전반)

- **활성 항목**: 좌측 2px accent bar + `bg-primary/12` + 3D 아이콘 drop-shadow 강조 조합.
- **호버**: `bg-sidebar-accent/70`, 부드러운 150ms 전환.
- **타이포**: 섹션 라벨 `text-[10px] font-bold tracking-[0.14em] uppercase`, 모듈/리프 `text-[13px]`, 계층별 굵기 차등.
- **모듈 그룹 카드화**: `rounded-lg` 컨테이너 + `bg-sidebar-accent/25`로 시각 그루핑, 접힘 상태에서는 카드 배경 제거.
- **헤더**: 브랜드/사용자 2행 구조. 역할 배지 시맨틱(Admin=primary, D.Super=info, Senior=success, Guest=muted) 통일.
- **접힘 시 헤더**: 브랜드 아이콘 + 미니 아바타만 표시, 로그아웃 버튼은 유지.

## 변경 파일

- `src/components/layout/AppLayout.tsx` — 사이드바 구조/스타일 재작성, 접기 상태 관리, `NavIcon` 도입, Tooltip/HoverCard 배선, NAV 항목의 `icon` 필드를 3D 이미지 경로로 교체.
- `src/components/layout/TopBrandHeader.tsx` — 좌측에 접기/펼치기 토글 버튼 추가 (collapsed, onToggle props 주입).
- `src/assets/nav-icons/` (신규) — 3dicons에서 선별한 20여 개 PNG 자산.
- `src/styles.css` — 사이드바 활성/호버 세부 유틸(선택), `prefers-reduced-motion` 예외.

## 비변경/보존

- NAV 구조, 권한 필터링, 라우팅, 모듈 열림 상태 로컬스토리지 로직 유지.
- 모바일 오버레이 UX 현행 유지 (접기 버튼은 데스크톱 전용).
- 사이드바 외 화면(대시보드/Raw Data 등)의 lucide 아이콘은 그대로 유지.

## 수용 기준

- 사이드바의 모든 NAV 항목이 3dicons의 통일된 3D 스타일 아이콘으로 표시된다.
- 데스크톱 헤더 토글 클릭 시 사이드바가 64px로 축소되고 본문이 즉시 넓어진다. 새로고침 후에도 상태 유지.
- 접힘 상태에서 리프는 Tooltip, 모듈은 HoverCard로 라벨/하위 항목에 접근 가능하며, 모든 라우트에 도달 가능.
- 활성 항목이 펼침/접힘/모바일 모든 상태에서 명확히 구분된다.
- 모바일 오버레이 동작은 변하지 않는다.
- 아이콘 자산 추가로 인한 초기 번들 증가는 100KB 미만(20개 × 3~5KB PNG 예상).
