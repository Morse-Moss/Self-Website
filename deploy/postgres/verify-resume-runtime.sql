DO $$
DECLARE
  missing_privileges text[];
BEGIN
  SELECT array_agg(format('%s:%s', table_name, privilege) ORDER BY table_name, privilege)
    INTO missing_privileges
    FROM unnest(ARRAY[
      'resume_documents',
      'resume_invites',
      'resume_sessions',
      'resume_access_events'
    ]) AS private_table(table_name)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS required(privilege)
   WHERE NOT has_table_privilege(
     'runtime',
     format('public.%I', table_name),
     privilege
   );

  IF missing_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role is missing private resume privileges: %', missing_privileges;
  END IF;
END
$$;
