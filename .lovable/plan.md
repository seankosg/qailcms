# OCS Baseline v1 호환 모드 추가

## 문제 (실측 확인)

로컬 도구 `ocs_increment_tool/baseline.py` 는 v1 계약만 허용하는데, 앱은 현재 v2 만 생성합니다.

- `src/lib/abd/ocs-baseline-shared.ts:5` — `BASELINE_SCHEMA_VERSION = "ocs-baseline-v2"`
- `src/lib/abd/ocs-baseline.functions.ts:335-354` — ZIP 에 `validation/abd_items_index.json` 추가
- 같은 파일 `:379-384` — 해당 파일이 `manifest.files` 에 `row_count` 와 함께 등재

→ 도구가 낸 3가지 오류(schema_version 불일치 / extra=['abd_items_index'] / row_count 불일치)와 정확히 일치합니다.

## 방향

앱에 **v1 호환 생성 모드**를 추가합니다. 기본은 v2 유지, 사용자가 선택하면 v1 규격(10개 데이터셋 + manifest, 인덱스 파일 없음, `schema_version = ocs-baseline-v1`) ZIP 을 만들어 다운로드합니다. 파이썬 도구는 수정하지 않습니다.

## 작업 내용

1. **생성 함수에 모드 파라미터 추가** — `createOcsBaseline` 에 `compat: "v2" | "v1"`(기본 v2) 입력을 받습니다.
   - v1 일 때: `schema_version` 을 `ocs-baseline-v1` 로 쓰고, 인덱스 파일 생성·ZIP 수록·manifest 등재를 모두 건너뜁니다.
   - `baseline_id` 산식은 그대로(`schema_version|core_hash|latest_run_id`)이므로 v1 은 자연히 다른 ID 가 되어 v2 ZIP 과 폴더가 겹치지 않습니다. 재사용/사이드카 로직도 ID 기준이라 그대로 동작합니다.
   - 증분 Import 서버 관문은 이미 v1/v2 두 ID 를 모두 허용하므로(`computeBaselineIdCandidates`) 추가 변경 없음.

2. **Baseline 카드 UI** — `OcsBaselineCard.tsx` 에 생성 규격 선택(토글 2개: 기본 v2 / 로컬 도구 호환 v1)을 추가하고, 결과 요약에 생성된 규격을 표시합니다. 안내 문구도 "파일 11종"과 "10종"이 규격에 따라 달라지도록 정정합니다.

3. **검증** — v1 로 생성한 ZIP 의 manifest 를 실제로 열어 `schema_version`, 파일 목록 10개, `total_rows` 가 데이터셋 합계와 일치하는지 실측 확인 후 보고합니다.

## 범위 밖

- 파이썬 도구 수정 없음
- v2 계약·로컬 검증 카드·증분 Import 흐름 변경 없음
- DB 스키마·RPC 변경 없음
