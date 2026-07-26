# ABD Raw Data 0건 표시 — 원인과 수정

## 원인

브라우저 네트워크 로그에 `abd_items_search` RPC가 400으로 실패 중:

```
{"code":"42703","message":"column \"is_excluded\" does not exist"}
```

- 마이그레이션 `20260726052939_...sql` 에서 `abd_items_search` 오버로드에 `_excluded_mode` 인자를 추가하며 `coalesce(is_excluded, false)` 조건을 삽입.
- 그러나 `abd_items_raw` 테이블에 존재하는 컬럼은 `is_terminated` 뿐이며 `is_excluded` 컬럼은 없음(과거 Aconex 파서 도입 이후 컬럼 추가 마이그레이션 누락).
- 같은 시점 `abd_items_counts` RPC는 `is_terminated` 를 사용하므로 정상 (200), 검색 RPC만 실패.
- 결과: 목록·필터 결과가 모두 0건으로 표시. 실제 DB에는 6,710행 존재 확인.

## 수정

새 마이그레이션 1개로 `abd_items_search`의 `is_excluded` 참조를 `is_terminated` 로 치환 (counts RPC 및 파서 semantic 과 통일). 컬럼 추가는 하지 않음 — 데이터 소스가 이미 `is_terminated` 로 정착돼 있음.

수정 지점 (RPC 본문 내):

- `_allowed_cols` 배열의 `'is_excluded'` → `'is_terminated'`
- `_excluded_mode = 'only'` 분기: `coalesce(is_excluded, false) = true` → `coalesce(is_terminated, false) = true`
- 기본 분기(`hide`): `coalesce(is_excluded, false) = false` → `coalesce(is_terminated, false) = false`
- `all` 분기는 그대로 (필터 없음)

그 외 시그니처·리턴 타입·로직 변경 없음.

## 코드 정리 (동일 turn)

`src/lib/abd/aconex-parser.ts`, `src/lib/abd/aconex-import.functions.ts`, `src/components/abd/import/AbdAconexImportPage.tsx` 에 남아 있는 `is_excluded` 명명은 파서 내부 로컬 필드로만 사용되고 DB에는 쓰지 않으므로 이번 수정 범위와 무관 — 변경 없음.

## 검증

1. RPC 재호출: `abd_items_search(_team:'ARCH', _excluded_mode:'hide', ...)` 200 응답 및 rows > 0.
2. 프리뷰 새로고침 후 ABD Raw Data 페이지에 6,700+건 노출, Excluded 배지 토글(`hide/only/all`) 정상 동작 확인.
