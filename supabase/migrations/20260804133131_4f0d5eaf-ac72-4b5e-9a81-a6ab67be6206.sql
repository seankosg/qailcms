UPDATE public.rcl_permissions SET allowed = true
 WHERE role = 'senior_user' AND scope = 'own_team' AND action = 'write';
UPDATE public.rcl_permissions SET allowed = false
 WHERE role = 'senior_user' AND scope = 'own_team' AND action = 'delete';