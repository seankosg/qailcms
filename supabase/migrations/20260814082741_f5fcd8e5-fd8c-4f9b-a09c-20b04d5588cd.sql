INSERT INTO public.rcl_permissions (role, scope, action, allowed)
SELECT 'super_guest'::app_role, s.scope, a.action, (a.action = 'read')
FROM (VALUES ('own'),('own_team'),('other_team')) AS s(scope)
CROSS JOIN (VALUES ('read'),('write'),('delete'),('import'),('export')) AS a(action)
ON CONFLICT (role, scope, action) DO UPDATE SET allowed = EXCLUDED.allowed;