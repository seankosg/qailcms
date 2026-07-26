## 원인

ABD 임포트의 Master Mapping 다이얼로그에서 **Subcon**은 admin이 정상 등록되지만, **HDEC PIC / HDEC ENG**는 다음 이유로 등록이 차단되고 있습니다.

- `src/components/import/MasterMappingDialog.tsx` (L120~127): `masterKind === "hdec_pic" | "hdec_eng"`인 경우 무조건 토스트("HDEC PIC/ENG는 사용자관리에서만 등록됩니다")를 띄우고 `continue` 처리.
- `src/lib/admin/users.functions.ts`의 `MasterKind` 타입이 `subcontractor | subsub | team`만 지원 → `addMasterName`이 `hdec_pic_master` / `hdec_eng_master`에 insert할 수 없음.

즉, admin이 "신규 등록"을 선택해도 서버 함수가 대응하지 못해 UI에서 원천 차단되며, 이후 `handleApply`가 정상 완료 처리되어 다이얼로그가 그대로 닫혀버립니다. 사용자는 이를 "admin만 가능하다며 사라짐"으로 인지.

한편 `hdec_pic_master`, `hdec_eng_master` 테이블은 이미 존재하며 `useMasterOptions("hdec_pic"|"hdec_eng")`가 이를 읽고 있으므로, 마스터 테이블에 직접 insert하는 경로만 열어주면 됩니다 (사용자 계정 생성과는 무관).

## 변경 범위

### 1) 서버 함수 확장 — `src/lib/admin/users.functions.ts`

- `MasterKind` 타입에 `"hdec_pic" | "hdec_eng"` 추가.
- `tableForKind`에 `hdec_pic → hdec_pic_master`, `hdec_eng → hdec_eng_master` 매핑 추가.
- `addMasterName.handler`에서 kind가 `hdec_pic`/`hdec_eng`인 경우 `{ name, is_active: true }` payload로 insert.
- `assertAdmin` 유지 (admin/superuser만 등록 가능).
- `toggleMasterActive`, `deleteMaster` 등 다른 곳에서 `MasterKind`를 쓰는 함수도 새 kind에서 안전하게 동작하는지 확인하고 필요한 곳만 케이스 추가.

### 2) 다이얼로그 로직 개선 — `src/components/import/MasterMappingDialog.tsx`

- `hdec_pic` / `hdec_eng`에 대한 차단 토스트 및 `continue` 제거.
- 다른 kind와 동일하게 `addMaster({ data: { kind, name: e.rawName } })` 호출.
- 성공 시 `MASTER_OPTIONS_QK(e.masterKind)` invalidate.
- 실패 시(권한/중복 등) 개별 항목 토스트만 노출하고 사용자가 다시 시도할 수 있도록 다이얼로그가 자동으로 닫히지 않도록 흐름 조정 — 등록 실패가 하나라도 있으면 `onClose()` 호출을 건너뛰고 실패 항목을 상단에 하이라이트.

### 3) 안내 문구 정정 — `MasterMappingDialog.tsx`

- 헤더 설명 문구의 "신규 등록(admin)"을 "신규 등록(admin/superuser)"로 통일. Subcon/PIC/ENG 모두 동일 규칙임을 명시.

### 4) DB 권한 확인 (마이그레이션 필요 시)

- `hdec_pic_master`, `hdec_eng_master`에 `authenticated` INSERT 권한 및 admin/superuser 정책이 이미 있는지 SQL로 사전 확인.
- 정책이 없으면 마이그레이션 1건 추가:
  - `GRANT SELECT, INSERT, UPDATE ON public.hdec_pic_master TO authenticated;`
  - `GRANT SELECT, INSERT, UPDATE ON public.hdec_eng_master TO authenticated;`
  - RLS `insert` 정책 `has_any_role(auth.uid(), ARRAY['admin','superuser'])` 추가.

### 5) 검증

- `tsgo`로 타입 체크.
- admin 계정으로 ABD 임포트 실행 → Subcon/HDEC PIC/HDEC ENG 모두 "신규 등록"으로 처리 후 다이얼로그 정상 종료, 후속 임포트에서 매칭되는지 확인.
- 일반 사용자 계정에서는 여전히 등록 버튼이 비활성화(canRegister=false)되는지 회귀 확인.

## 사용자에게 보이는 변화

- admin/superuser는 임포트 매핑 다이얼로그에서 Subcon과 함께 **HDEC PIC / HDEC ENG도 즉시 신규 등록** 가능.
- 등록 실패 시 다이얼로그가 자동으로 닫히지 않아 재시도 가능.
