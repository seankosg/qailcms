
-- 1) unique(field_key) if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'abd_field_config_field_key_key'
  ) THEN
    ALTER TABLE public.abd_field_config
      ADD CONSTRAINT abd_field_config_field_key_key UNIQUE (field_key);
  END IF;
END $$;

-- 2) seed rows (idempotent upsert on field_key)
INSERT INTO public.abd_field_config (field_key, label, "group", data_type, editable, visible, sort_order)
VALUES
  ('sl_no','Sl.No','identity','number',false,true,10),
  ('plot','Plot','identity','text',false,true,20),
  ('dis','DIS','identity','text',false,true,30),
  ('service','Service','identity','text',false,true,40),
  ('abd_number','ABD Number','identity','text',false,true,50),
  ('abd_ocs_no','ABD OCS No.','identity','text',false,true,60),
  ('document_title','Document Title','content','text',true,true,70),
  ('pic','PIC','content','text',true,true,80),
  ('latest_rev','Latest Rev','latest','text',true,true,90),
  ('latest_status','Latest Status','latest','text',true,true,100),
  ('approval_date','Approval','latest','date',true,true,110),
  ('r1_drafting_plan','R1 Draft P','round1','date',true,true,120),
  ('r1_drafting_actual','R1 Draft A','round1','date',true,true,130),
  ('r1_submission_plan','R1 Sub P','round1','date',true,true,140),
  ('r1_submission_actual','R1 Sub A','round1','date',true,true,150),
  ('r1_dar_plan','R1 DAR P','round1','date',true,true,160),
  ('r1_dar_actual','R1 DAR A','round1','date',true,true,170),
  ('r2_drafting_plan','R2 Draft P','round2','date',true,true,180),
  ('r2_drafting_actual','R2 Draft A','round2','date',true,true,190),
  ('r2_submission_plan','R2 Sub P','round2','date',true,true,200),
  ('r2_submission_actual','R2 Sub A','round2','date',true,true,210),
  ('r2_dar_plan','R2 DAR P','round2','date',true,true,220),
  ('r2_dar_actual','R2 DAR A','round2','date',true,true,230),
  ('r3_drafting_plan','R3 Draft P','round3','date',true,true,240),
  ('r3_drafting_actual','R3 Draft A','round3','date',true,true,250),
  ('r3_submission_plan','R3 Sub P','round3','date',true,true,260),
  ('r3_submission_actual','R3 Sub A','round3','date',true,true,270),
  ('r3_dar_plan','R3 DAR P','round3','date',true,true,280),
  ('r3_dar_actual','R3 DAR A','round3','date',true,true,290),
  ('doc_ax','AX','segments','text',false,true,300),
  ('doc_axx','AXX','segments','text',false,true,310),
  ('doc_nn1','NN1','segments','text',false,true,320),
  ('doc_n','N','segments','text',false,true,330),
  ('doc_nn2','NN2','segments','text',false,true,340),
  ('is_active','Active','flags','text',false,true,350),
  ('data_date','Data Date','audit','date',false,true,360),
  ('updated_at','Updated','audit','date',false,true,370)
ON CONFLICT (field_key) DO NOTHING;
