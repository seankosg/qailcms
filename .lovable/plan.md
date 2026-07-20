
# 백업/복원 사용자 도움말 문서 & Help 버튼 구현 계획

## 목표
`/admin/backup` 페이지 상단 우측에 **Help(도움말)** 버튼을 배치하고, 클릭 시 백업/복원의 아키텍처·로직·사용 절차를 IT 비전문가도 이해할 수 있는 수준으로 상세히 담은 문서를 **다이얼로그로 열람**하거나 **PDF/Markdown 파일로 다운로드**할 수 있게 한다.

---

## 1. 문서 원본(Single Source of Truth)

경로: `src/content/backup-user-guide.md` (Markdown 원본)  
동일 내용을 다이얼로그·다운로드에 모두 사용.

### 목차 (한국어, 비전문가 눈높이)

1. **이 시스템은 무엇인가요?**  
   - 백업 = "지금 이 순간의 앱 전체 데이터를 안전한 금고에 넣어두기".  
   - 복원 = "금고에 넣어둔 특정 시점의 데이터를 다시 꺼내 앱을 그 상태로 되돌리기".  
   - 언제 필요한가: 실수로 대량 삭제, 잘못된 임포트, 데이터 오염, 감사 요구, 이관 등.
2. **한눈에 보는 그림**  
   - 자동 백업(매일 도하시각 23:50) → 안전한 저장소(Storage `db-backups`) → 필요 시 관리자가 복원.  
   - 다이어그램 이미지 1장 삽입 (`/docs/backup-architecture.svg` 신규 생성).
3. **백업의 구성 요소 (IT 용어 최소화 버전 + 괄호로 정식 용어)**  
   - 스냅샷 = 특정 시점 사진.  
   - 자동 백업 / 수동 백업 / 임포트 직전 안전 백업.  
   - 저장 위치, 보관 기간(Retention), 무결성 검증(체크섬).
4. **자동 백업은 언제 실행되나요?**  
   - 기본값: **매일 카타르 시간(AST, UTC+3) 23:50**.  
   - 요일·시각 변경 방법 (Backup Status 카드 조작 스텝).  
   - 실패/지연 시 어떻게 되는지(26시간 초과 시 경고 배지).
5. **수동으로 백업 만들기 (3-Step)**  
   Step 1 "Create Snapshot" 카드 열기 → Step 2 메모 입력 → Step 3 "Save Current Data" 클릭 → 진행률 확인.
6. **알림 설정**  
   - 성공/경고/실패 각각 켜고 끄기.  
   - Webhook URL(Slack 등) 설정 예시 스크린샷 자리.
7. **로컬(내 컴퓨터)에 백업 파일 내려받기**  
   - 스냅샷 목록에서 **Download .zip** 버튼 클릭.  
   - 다운로드된 zip의 구조 설명(`manifest.json`, `<테이블>__part_NNN.json`, `storage/`, `auth_users.json`, `hash.json`).  
   - 안전 보관 팁: 회사 정책상 어디 두어야 하는지 가이드.
8. **복원(Restore) — 가장 중요한 챕터**  
   - **경고 박스**: 복원은 관리자(admin)만 실행 가능. 실행 즉시 현재 데이터가 대체된다.  
   - **A. 전체 복원 절차 (6-Step, 스크린샷 자리 포함)**  
     1) `/admin/backup` 진입 → 2) 원하는 스냅샷의 Restore 클릭 → 3) "Pre-restore safety backup" 체크 유지(권장) → 4) `RESTORE <스냅샷명>` 확인 문구 입력 → 5) Run → 6) Restore Run Log에서 결과 확인.  
   - **B. 선택 복원(Selective Restore)** — 일부 테이블만 되돌리기: 사용 사례(SM만 이상 → SM만 복원), 체크박스 선택 방법, 마스터 테이블은 함께 복원 권장 경고.  
   - **C. 사용자 계정(auth users) 복원 옵션**  
   - **D. 파일(Storage) 복원은 백그라운드로 이어짐** — 왜 즉시 안 끝나는지 설명, 진행률 보는 위치.  
   - **E. 복원 후 반드시 확인할 3가지**: 행 수, 무결성 리포트, 도출 컬럼(status/derived) 재계산 완료 여부.
9. **자주 있는 상황별 시나리오 (Playbook)**  
   - 시나리오 A: "방금 잘못된 파일을 임포트했어요"  
   - 시나리오 B: "누군가 특정 테이블의 행을 대량 삭제했어요"  
   - 시나리오 C: "어제 저녁 이전 상태로 되돌리고 싶어요"  
   - 시나리오 D: "감사(Audit)용으로 특정 시점 데이터를 뽑고 싶어요 (복원 없이 다운로드만)"  
   각 시나리오에 필요한 단계 3~5개씩.
10. **보관 정책(Retention)이 뭐고 어떻게 조정하나요?**  
    - keep_last_n / keep_days 의미.  
    - **Lock 아이콘**을 눌러 특정 스냅샷은 자동 삭제에서 제외하는 법.
11. **문제 해결(FAQ)**  
    - "Download 버튼이 회색이에요" → 권한 문제.  
    - "복원 버튼이 안 보여요" → admin 계정만 가능.  
    - "Overdue 배지가 떠요" → 지난 26시간 동안 자동 백업 성공 없음. 수동 실행 절차.  
    - "무결성 검증 실패 표시" → 재백업 또는 관리자 문의.
12. **용어 사전**  
    스냅샷 / Manifest / SHA-256 / Retention / RLS / auth users / Storage bucket 등을 한 줄씩.
13. **책임과 한계**  
    - 백업 주기 사이의 데이터 변경은 손실될 수 있음.  
    - `auth`/`storage`/`vault` 시스템 스키마는 별도 규칙으로 처리됨을 명시.

---

## 2. Help 버튼 & 다이얼로그 UI

**컴포넌트**: `src/components/admin/backup/BackupHelpDialog.tsx` (신규)

- 페이지 상단 우측에 `<Button variant="outline" size="sm">` + `HelpCircle` 아이콘, 라벨 "도움말 / Help".
- 클릭 시 shadcn `Dialog` (max-w-4xl, max-h-[85vh], overflow-y-auto) 오픈.
- 다이얼로그 헤더: 제목 "백업 & 복원 사용자 가이드" + 우측에 두 개 버튼:
  - **Markdown 다운로드** (`.md` 원본 파일)
  - **PDF 다운로드** (아래 참조)
- 본문: Markdown 원본을 `react-markdown` + `remark-gfm`로 렌더링. 코드블록/표/체크리스트/경고박스(콜아웃) 스타일링.
- 목차(TOC) 좌측 사이드 앵커 링크 — 데스크톱만, 모바일은 상단 접힘.
- 이미지 자리(스크린샷·아키텍처 SVG)는 `src/assets/docs/` 신규 폴더 5장 내외.

## 3. 다운로드 기능

- **Markdown 다운로드**: 원본 `.md` 문자열을 Blob으로 만들어 `<a download>` 트리거. 서버 왕복 없음.
- **PDF 다운로드**: 클라이언트 사이드 렌더링(라이브러리 검토)  
  - 옵션 1(권장): `html2pdf.js` 또는 `jspdf` + `html2canvas` — 다이얼로그 본문 DOM을 그대로 캡처. 이미지·표 포함.  
  - 옵션 2: 서버 라우트 `/api/public/backup-guide.pdf`에서 `puppeteer`… → **Worker 런타임 미지원이라 옵션 1 채택**.  
  - 파일명: `QAIL_Backup_Restore_Guide_YYYYMMDD.pdf`.
- **아키텍처 SVG**: 별도 `docs/backup-architecture.svg`도 다이얼로그 내에서 우클릭 저장 가능하도록 첨부.

## 4. 접근 위치 (상단 Help 버튼)

- 1차 배치: `/_authenticated/admin/backup.tsx` 페이지 헤더.
- 2차 배치(선택): 모든 페이지 공용 `TopBrandHeader.tsx` 우측에 작은 Help 아이콘 → 클릭 시 컨텍스트 인식하여 백업 페이지에 있을 때만 이 문서를 열도록, 그 외에는 향후 다른 도움말 문서 라우팅 준비. (이번 스코프에서는 hook 구조만 예약, 실제 노출은 백업 페이지 한정.)

## 5. 유지보수 규칙

- 문서는 항상 **한국어 원본**으로 유지, 영어 병기는 기술 용어에 한함.
- 백업 UI/로직이 변경될 때 `src/content/backup-user-guide.md`도 같이 업데이트해야 함을 `AGENTS.md`에 한 줄 기록.
- 다이얼로그 상단에 "문서 버전: v1.0 · 최종 수정 YYYY-MM-DD"를 자동으로 표시(파일 상단 frontmatter에서 파싱).

---

## 6. 영향 파일

- 신규
  - `src/content/backup-user-guide.md`
  - `src/components/admin/backup/BackupHelpDialog.tsx`
  - `src/lib/backup/download-guide.ts` (Markdown/PDF 생성 헬퍼)
  - `src/assets/docs/backup-architecture.svg` (+ 스크린샷 4~5장)
- 수정
  - `src/routes/_authenticated/admin/backup.tsx` — 상단 Help 버튼 삽입
  - `AGENTS.md` — 유지보수 규칙 한 줄 추가
- 의존성 추가
  - `react-markdown`, `remark-gfm`, `html2pdf.js` (또는 `jspdf` + `html2canvas`)

---

## 7. 확인 필요

1. PDF 라이브러리는 `html2pdf.js` 채택으로 확정해도 될까요? (용량 ~150KB gzip)  
2. 스크린샷 이미지는 이번 문서에 **자리(placeholder)만 넣고**, 실제 캡처는 백업 시스템 배포 후 별도 커밋으로 추가하는 방식이 좋을까요, 아니면 즉시 임시 mock 스크린샷을 생성해 넣을까요?

승인 시 원본 마크다운 → 다이얼로그/다운로드 → 상단 버튼 순으로 구현하겠습니다.
