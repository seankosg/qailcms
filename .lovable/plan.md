## 결론

캡쳐 화면에서 보이는 매핑 row는 정상 상태입니다.

- **Source Header (Excel)**: `Data Date` — 업로드하는 Excel 파일의 원본 헤더 문자열
- **Target Field**: `data_date` — DB 컬럼 키 (`defect_items_raw.data_date`)

즉, "Excel의 `Data Date` 열을 시스템 필드 `data_date`에 넣는다"는 매핑입니다. Target Field 컬럼은 의도적으로 **DB 컬럼 키(raw key)** 를 그대로 노출하도록 되어 있어, 관리자가 실제 저장 위치를 명확히 확인할 수 있습니다.

## 이전 답변과의 관계

앞서 안내한 "표시 필드명은 **Data Date**" 는 `defect_field_config.display_name` 값(= Field Config 탭·필터·컬럼 헤더에서 사용자에게 보이는 라벨)을 뜻합니다. Header Mapping 탭의 Target Field 컬럼은 라벨이 아니라 **연결 대상 키**를 보여주는 자리라, 두 값이 다르게 보이는 것이 정상입니다.

정리:

| 위치 | 표시값 | 의미 |
|---|---|---|
| Field Config 목록 / Raw Data 컬럼 헤더 / 필터 | `Data Date` | 사용자용 라벨(display_name) |
| Header Mapping · Target Field | `data_date` | DB 컬럼 키(raw key) |
| Excel 원본 헤더 | `Data Date` | 임포트 파일의 헤더 문자열 |

## 변경 사항

사용자가 "현재 유지"를 선택하셨으므로 **코드/DB 변경 없음**. 이 플랜은 상태 확인/설명만 담고 있으며, 승인 시 별도 파일 수정은 발생하지 않습니다.
