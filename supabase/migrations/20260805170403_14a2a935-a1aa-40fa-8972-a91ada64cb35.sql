-- Idempotent pin of the canonical RCL grid (60 cells).
-- Admin / guest / super_guest rows are intentionally untouched.
WITH canon(role, scope, action, allowed) AS (
  VALUES
  -- user
  ('user','own','read',true),('user','own','write',true),('user','own','delete',true),('user','own','import',true),('user','own','export',true),
  ('user','own_team','read',true),('user','own_team','write',false),('user','own_team','delete',false),('user','own_team','import',false),('user','own_team','export',false),
  ('user','other_team','read',false),('user','other_team','write',false),('user','other_team','delete',false),('user','other_team','import',false),('user','other_team','export',false),
  -- senior_user
  ('senior_user','own','read',true),('senior_user','own','write',true),('senior_user','own','delete',true),('senior_user','own','import',true),('senior_user','own','export',true),
  ('senior_user','own_team','read',true),('senior_user','own_team','write',true),('senior_user','own_team','delete',true),('senior_user','own_team','import',true),('senior_user','own_team','export',true),
  ('senior_user','other_team','read',true),('senior_user','other_team','write',false),('senior_user','other_team','delete',false),('senior_user','other_team','import',false),('senior_user','other_team','export',false),
  -- d_superuser
  ('d_superuser','own','read',true),('d_superuser','own','write',true),('d_superuser','own','delete',true),('d_superuser','own','import',true),('d_superuser','own','export',true),
  ('d_superuser','own_team','read',true),('d_superuser','own_team','write',true),('d_superuser','own_team','delete',true),('d_superuser','own_team','import',true),('d_superuser','own_team','export',true),
  ('d_superuser','other_team','read',true),('d_superuser','other_team','write',true),('d_superuser','other_team','delete',false),('d_superuser','other_team','import',true),('d_superuser','other_team','export',true),
  -- superuser
  ('superuser','own','read',true),('superuser','own','write',true),('superuser','own','delete',true),('superuser','own','import',true),('superuser','own','export',true),
  ('superuser','own_team','read',true),('superuser','own_team','write',true),('superuser','own_team','delete',true),('superuser','own_team','import',true),('superuser','own_team','export',true),
  ('superuser','other_team','read',true),('superuser','other_team','write',true),('superuser','other_team','delete',true),('superuser','other_team','import',true),('superuser','other_team','export',true)
)
UPDATE public.rcl_permissions p
   SET allowed = c.allowed
  FROM canon c
 WHERE p.role::text = c.role
   AND p.scope::text = c.scope
   AND p.action::text = c.action
   AND p.allowed IS DISTINCT FROM c.allowed;