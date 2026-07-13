ALTER TABLE public.defect_items_raw
  ADD COLUMN building    text NULL,
  ADD COLUMN room        text NULL,
  ADD COLUMN room_group  text NULL,
  ADD COLUMN level_name  text NULL,
  ADD COLUMN review_flag text NULL;