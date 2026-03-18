insert into public.module_permission_templates (role, module_key, access_level)
values
  ('ceo', 'inventory', 'edit'),
  ('ceo', 'reports', 'edit'),
  ('ceo', 'vendors', 'edit'),
  ('ceo', 'documents', 'edit'),
  ('ceo', 'training', 'edit'),
  ('ceo', 'integrations', 'edit'),

  ('manager', 'inventory', 'edit'),
  ('manager', 'reports', 'none'),
  ('manager', 'vendors', 'edit'),
  ('manager', 'documents', 'edit'),
  ('manager', 'training', 'edit'),
  ('manager', 'integrations', 'none'),

  ('foreman', 'inventory', 'none'),
  ('foreman', 'reports', 'none'),
  ('foreman', 'vendors', 'none'),
  ('foreman', 'documents', 'view'),
  ('foreman', 'training', 'view'),
  ('foreman', 'integrations', 'none'),

  ('mechanic', 'inventory', 'edit'),
  ('mechanic', 'reports', 'none'),
  ('mechanic', 'vendors', 'none'),
  ('mechanic', 'documents', 'none'),
  ('mechanic', 'training', 'view'),
  ('mechanic', 'integrations', 'none'),

  ('operator', 'inventory', 'none'),
  ('operator', 'reports', 'none'),
  ('operator', 'vendors', 'none'),
  ('operator', 'documents', 'view'),
  ('operator', 'training', 'none'),
  ('operator', 'integrations', 'none'),

  ('fieldstaff', 'inventory', 'none'),
  ('fieldstaff', 'reports', 'none'),
  ('fieldstaff', 'vendors', 'none'),
  ('fieldstaff', 'documents', 'view'),
  ('fieldstaff', 'training', 'none'),
  ('fieldstaff', 'integrations', 'none'),

  ('manager', 'finance', 'none')
on conflict (role, module_key) do update
set access_level = excluded.access_level,
    updated_at = now();
