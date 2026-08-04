ALTER TABLE public.hdec_eng_name_master
  DROP CONSTRAINT IF EXISTS hdec_eng_name_master_linked_user_id_fkey,
  ADD CONSTRAINT hdec_eng_name_master_linked_user_id_fkey
    FOREIGN KEY (linked_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.hdec_pic_name_master
  DROP CONSTRAINT IF EXISTS hdec_pic_name_master_linked_user_id_fkey,
  ADD CONSTRAINT hdec_pic_name_master_linked_user_id_fkey
    FOREIGN KEY (linked_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;