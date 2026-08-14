select set_config('spl.change_source','reqdoc_vocab_normalize_20260814', true);

-- ② 자유서술 17건 원문을 remarks 로 이동 (remarks 가 비어 있을 때만)
update public.spl_stage_progress p
set remarks = p.flag_value
from public.spl_stage_catalog c
where c.stage_code = p.stage_code
  and c.band = 'REQUIRED_DOC'
  and p.flag_value in ('SPL are incomplete as per specs','Mfg. Letter for physical','Rqrd-Not final','Specialist Letter for physical')
  and coalesce(btrim(p.remarks),'') = '';

-- ③ 사전대로 flag_value 정규화
update public.spl_stage_progress p
set flag_value = 'REQUIRED'
from public.spl_stage_catalog c
where c.stage_code = p.stage_code
  and c.band = 'REQUIRED_DOC'
  and (
    upper(btrim(p.flag_value)) in ('O','YES','NOT YET')
    or btrim(p.flag_value) in ('SPL are incomplete as per specs','Mfg. Letter for physical','Rqrd-Not final','Specialist Letter for physical')
  );

update public.spl_stage_progress p
set flag_value = 'N/A'
from public.spl_stage_catalog c
where c.stage_code = p.stage_code
  and c.band = 'REQUIRED_DOC'
  and upper(btrim(p.flag_value)) in ('X','0');