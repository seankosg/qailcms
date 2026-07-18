## 목표
캡쳐 이미지 최상단의 "현대건설 로고 + 앱 이름 + 우측 액션" 헤더를 그대로 이식하되, 라벨은 **"QAIL PROJECT COMPLETION MANAGEMENT SYSTEM"** 으로 표시. 데스크톱/모바일 모두 노출.

## 작업 범위

### 1. 로고 자산 등록
- `user-uploads://hyundai-logo-poeB6Ayj.png` → `lovable-assets create` 로 CDN 업로드
- 포인터: `src/assets/hyundai-logo.png.asset.json`

### 2. `TopBrandHeader.tsx` 신설 (`src/components/layout/`)
구성 (좌 → 우):
- **모바일 전용**: 햄버거 버튼(`Menu`) — `lg:hidden`, `onMobileMenu` prop
- **로고**: `<img>` height 28px (모바일 24px)
- **시스템 이름**: `QAIL PROJECT COMPLETION MANAGEMENT SYSTEM`
  - 데스크톱: 전체 표시, `text-sm font-medium tracking-wide text-muted-foreground`
  - 모바일(<sm): `QAIL CMS` 로 축약 표시 (`sm:hidden` / `hidden sm:inline` 스위칭)
- `flex-1` 스페이서
- **우측 영역**:
  - `New Version` 버튼 (`Button variant="outline" size="sm"`, `Sparkles` 아이콘) — 클릭 시 현재는 no-op (추후 릴리즈 노트 연결 여지)
  - 저작권 텍스트: `© 2026 QAIL CMS. All rights reserved.` — `hidden md:inline text-xs text-muted-foreground`
  - 알림 벨 아이콘 버튼 (`Bell`, `Button variant="ghost" size="icon"`) — no-op

전체 컨테이너: `sticky top-0 z-20 h-14 border-b bg-card px-4 flex items-center gap-3`

### 3. `AppLayout.tsx` 통합
- 기존 사이드바 상단 브랜드 블록(`Wrench + QAIL CMS`) 유지 (사이드바 자체 브랜딩)
- 메인 컬럼 최상단의 기존 모바일 전용 `<header>`(햄버거 + QAIL CMS)를 **삭제**
- 그 자리에 `<TopBrandHeader onMobileMenu={() => setMobileOpen(true)} />` 삽입 → 데스크톱·모바일 모두 노출
- 기존 sign-out/유저 정보 사이드바 푸터는 그대로

### 4. 검증
- `tsgo --noEmit`
- Playwright로 데스크톱(1280) / 모바일(390) 캡쳐하여 정렬·축약·햄버거 동작 확인

## 스코프 외
- New Version 버튼과 벨 아이콘의 실제 기능(릴리즈 모달, 알림 센터)은 이번 범위 아님 — 시각적 배치만 원본과 동일하게 재현하고 클릭은 no-op으로 둠. 이후 별도 요청 시 연결.

승인해 주시면 바로 구현하겠습니다.
