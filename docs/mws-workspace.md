# My Work Space (MWS) / My Team Work Space (MTWS)

## 필터 스코프

- **MWS**: `profiles.hdec_pic_name = <나>` 기준. 내가 담당한 항목만.
- **MTWS**: `profiles.team = <내 팀>` 기준. 팀 전체 항목.
- **Admin**: 필터 없음. 전체 데이터.

## 섹션 구성

1. **Comments Inbox** — 내 항목 댓글 (TM/SM/ABD/SP 4개 모듈).
2. **ABD Attention Inbox** — 계획필요 / 지연 / 임박 3버킷.
3. **Task Management** — 담당 태스크 5개 KPI + 오늘/지연/임박/전체 탭.
4. **Snag List** — 담당 스낵 5개 KPI + 서버 판정 버킷.
5. **As Built Drawing** — 담당 ABD 5개 KPI + 계획필요 KPI.

## 판정 정의 (도하 기준시)

| 상태 | 정의 |
|------|------|
| **오늘** | 계획 시작/마감이 오늘인 항목 (TM: Start/Finish, SM: Start/Rectify/Close, ABD: Draft/Sub/Resp) |
| **지연** | 계획 마감일 < 오늘 AND 미완료 |
| **임박 (3d)** | 계획 마감일이 오늘 이후 1~3일 이내 AND 미완료 |
| **진행중** | 실적 진도 > 0 AND 미완료 |
| **완료** | TM: `actual_progress >= 1` OR auto_judgment='완료' · SM: status Closed/Verified/Rectified 또는 실적일 존재 · ABD: `latest_status='A'` |
| **계획필요 (ABD)** | Response=B/C 인데 다음 라운드 DS/DF/Sub 계획이 모두 비어있는 항목 |

## Comments Inbox vs Attention Inbox

| 구분 | 근거 | 대상 |
|------|------|------|
| Comments Inbox | `*_comments` 테이블 실시간 조회 | 사용자 대화 |
| Attention Inbox | Raw Data 계산 컬럼 (`is_delayed`, `needs_planning` 등) | 시스템 알림 (ABD 우선) |

두 Inbox 모두 좌측 파란 라인 = 미확인. localStorage 기반 사용자별 읽음 상태.

## 데이터 기준일 (Data Date)

헤더 우측 `DataDatePicker`로 과거 시점 재계산 가능. 기본값은 오늘 (도하).

## 컬럼 순서 / 고정 / 표시 여부

- 우측 `Columns` 버튼 → `MwsColumnOrderMenu`.
- 서버 저장: `user_view_preferences` 테이블 (`mws-tm`, `mws-sm`, `mws-abd` +/− `-team` suffix).
- 강제 고정: `__ctx` (구분 컬럼).