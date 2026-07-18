## 우선 조치 — HDEC PIC 마스터 채우기

겸직(hdec_eng) 결정은 뒤로 미루고, 먼저 **현재 27명 사용자 이름을 `hdec_pic_master`에 등록**하는 작업만 실행합니다. 이 조치로 관리자 UI의 Linked Master 셀렉트에 실제 옵션이 노출되어 매핑 편집이 가능해집니다.

### 대상 데이터 (실측)

`profiles`에서 `user_type IN ('hdec','hdec_pic')` 이고 `hdec_pic_name`이 채워진 27명 전부:

```
BH PARK_박복현, BM SEO_서봉문, CH SEO_서창훈, DH LIM_임대현, DS KIM_김대수,
HT AHN_안형태, HW CHAE_채홍욱, HY KIM_김홍엽, JH BAEK_백주호, JH CHO_조준혁,
JH LEE_이주한, JS SUNG_성종수, JYLEE(이준용), KD PARK_박기덕, KH JUNG_정경호,
KR NA_나경락, MC PARK_박명천, MH SHIN_신민호, MS CHOI_최민수, NK LEE_이남길,
SC LEE_이세철, SEOK LEE_이석, TW YOO_유태완, WJ SHIN_신원재, YH HAN_한영훈,
YK SUNG_성영광, YS KIM_김영서
```

현재 `hdec_pic_master`에는 `Admin` 1건만 있어서 사실상 선택 불가 상태입니다.

### 실행 내용 (`supabase--insert` 1회)

`hdec_pic_master`에 아래 SQL로 27건 upsert 수행:

```sql
INSERT INTO public.hdec_pic_master (name, is_active)
SELECT DISTINCT hdec_pic_name, true
FROM public.profiles
WHERE user_type IN ('hdec','hdec_pic')
  AND hdec_pic_name IS NOT NULL
ON CONFLICT (name) DO UPDATE SET is_active = true;
```

- `name` 컬럼의 unique 제약을 활용한 upsert이므로 기존 `Admin` 항목은 유지됩니다.
- 완료 후 `SELECT count(*) FROM hdec_pic_master WHERE is_active` 로 28건(27 신규 + Admin) 확인.

### 이후(별도 진행)

- `hdec_eng_master` 채우기 및 26명 겸직 개별 검토 → 사용자가 유지/삭제 리스트를 알려주시면 별도 단계로 처리.
- `profiles → hdec_pic_master/hdec_eng_master` 자동 동기화 트리거 도입.
- 관리자 UI `LinkedMasterCell` 겸직 편집 UI, 미등록 배지, `admin` 계정 레거시 user_type 정리 등 Phase B 항목.

**이 마이그레이션(정확히는 데이터 삽입)만 우선 실행할까요? 승인해 주시면 바로 진행합니다.**