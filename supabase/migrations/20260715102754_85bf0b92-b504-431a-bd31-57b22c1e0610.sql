-- Phase 1-1: Enum expansion
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_guest';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'senior_user';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'd_superuser';

ALTER TYPE public.user_type ADD VALUE IF NOT EXISTS 'subsub';
ALTER TYPE public.user_type ADD VALUE IF NOT EXISTS 'guest';