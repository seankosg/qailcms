## 왜 도면 번호 검색에 `pic` 컬럼을 찾았나요?

검색창에 입력한 값은 단순히 **검색어(text)**일 뿐입니다. ABD 검색 함수 `abd_items_search`는 "사용자가 입력한 단어를 여러 컬럼에서 동시에 찾자"는 방식으로 동작합니다.

즉, 검색어가 `"9206-BP12C-…-21526"`이면 DB에 다음과 같은 SQL이 만들어집니다.

```sql
abd_number::text ilike '%9206-…-21526%'
OR abd_ocs_no::text ilike '%9206-…-21526%'
OR document_title::text ilike '%9206-…-21526%'
OR pic::text ilike '%9206-…-21526%'        ← 문제!
OR dis::text ilike '%9206-…-21526%'
OR ...
```

여기서 `pic`은 함수 내부의 "검색 대상 컬럼 목록"(`_search_cols`)에 들어 있었지만, 실제 테이블에는 `pic`이라는 컬럼이 없습니다. 테이블에는 `hdec_pic_name`, `hdec_eng_name`만 존재합니다.

그래서 `pic` 줄을 실행할 때 DB가 **"column \"pic\" does not exist"** 오류를 내고, 검색 결과가 0건으로 반환됩니다.

요약하면:
- **검색어 자체가 `pic`을 찾은 게 아니라**, 검색 함수가 검색어를 여러 컬럼에 동시에 대조하는데 그중에 존재하지 않는 `pic` 컬럼이 섞여 있었던 것입니다.
- 도면 번호, OCS 번호, 제목, DIS, Service, 담당자 이름 등에서 모두 찾기 위해 넓게 설정한 것은 맞지만, 실제 테이블 컬럼과 맞지 않아 오류가 발생했습니다.

## 수정 계획

### 1. `abd_items_search` 함수 마이그레이션

`_search_cols` 배열을 실제 테이블 컬럼과 일치하도록 수정:

- **삭제**: `pic` (존재하지 않음)
- **추가**: `hdec_pic_name`, `hdec_eng_name` (담당자 이름 검색용)
- **유지**: `abd_number`, `abd_ocs_no`, `document_title`, `dis`, `service`, `plot`, `latest_rev`, `latest_status`, `doc_ax`, `doc_axx`, `doc_nn1`, `doc_n`, `doc_nn2`

### 2. 검증

- `9206-BP12C-HDEC-ABD-FRS-NS-LLG-21526` 입력 시 1건 반환
- 담당자 이름 검색도 정상 동작
- 검색어 없는 상태(기본 목록)도 이전과 동일하게 동작

## 영향 범위

- 프론트엔드 수정 불필요
- ABD Raw Data 검색 기능만 수리
- 다른 모듈(SM, TM, SP, DMR)은 영향 없음
