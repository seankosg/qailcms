-- Phase A 재실행: 전 행 삭제 + 파생 트리거 임시 비활성화
ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_compute_derived;
DELETE FROM public.abd_items_raw;