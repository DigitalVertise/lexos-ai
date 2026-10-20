-- Client-portal isolation test. Same pattern as tenant_isolation.sql: one DO
-- block that always raises at the end, so nothing is committed.
-- Success = "PORTAL_ISOLATION_OK"; any other message names the failed check.
do $$
declare
  lawyer uuid := gen_random_uuid();
  client_user uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  org_a uuid; c1 uuid; c2 uuid; m1 uuid; m2 uuid; d_shared uuid; d_private uuid; n int; j jsonb; p text;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data) values
    (lawyer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lawyer-' || lawyer || '@test.local', now(), '{}'),
    (client_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-' || client_user || '@test.local', now(), '{}'),
    (stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x-' || stranger || '@test.local', now(), '{}');

  -- Lawyer sets up a firm with two clients, a matter each, and two documents.
  perform set_config('request.jwt.claims', json_build_object('sub', lawyer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  org_a := public.create_organization('Portal Firm', 'Lawyer');
  update public.organizations set portal_slug = 'portal-firm-test', portal_enabled = true, brand_primary = '#123456' where id = org_a;
  insert into public.clients (org_id, name, created_by) values (org_a, 'Client One', lawyer) returning id into c1;
  insert into public.clients (org_id, name, created_by) values (org_a, 'Client Two', lawyer) returning id into c2;
  insert into public.matters (org_id, number, client_id, title, created_by) values (org_a, 0, c1, 'M1', lawyer) returning id into m1;
  insert into public.matters (org_id, number, client_id, title, created_by) values (org_a, 0, c2, 'M2', lawyer) returning id into m2;
  insert into public.documents (org_id, matter_id, title, source, storage_path, shared_with_client, created_by)
    values (org_a, m1, 'Shared', 'upload', org_a || '/x/shared.pdf', true, lawyer) returning id into d_shared;
  insert into public.documents (org_id, matter_id, title, source, storage_path, shared_with_client, created_by)
    values (org_a, m1, 'Private', 'upload', org_a || '/y/private.pdf', false, lawyer) returning id into d_private;
  insert into public.portal_access (org_id, client_id, email, invited_by)
    values (org_a, c1, 'client-' || client_user || '@test.local', lawyer);

  -- Branding is public; anon can read it.
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  select count(*) into n from public.portal_brand('portal-firm-test');
  if n <> 1 then raise exception 'FAIL: anon cannot read portal branding'; end if;
  begin
    perform public.portal_overview('portal-firm-test');
    raise exception 'FAIL: anon can call portal_overview';
  exception when insufficient_privilege then null;
  end;

  -- The client signs in, claims the invitation and sees only their own data.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', client_user, 'role', 'authenticated',
    'email', 'client-' || client_user || '@test.local')::text, true);
  execute 'set local role authenticated';
  n := public.portal_claim();
  if n <> 1 then raise exception 'FAIL: claim linked % rows', n; end if;
  j := public.portal_overview('portal-firm-test');
  if not (j->>'authorized')::boolean then raise exception 'FAIL: client not authorized'; end if;
  select count(*) into n from public.portal_my_portals() where slug = 'portal-firm-test';
  if n <> 1 then raise exception 'FAIL: portal_my_portals missing portal'; end if;
  if jsonb_array_length(j->'matters') <> 1 or (j->'matters'->0->>'id')::uuid <> m1 then raise exception 'FAIL: client sees wrong matters %', j->'matters'; end if;
  if jsonb_array_length(j->'documents') <> 1 or (j->'documents'->0->>'id')::uuid <> d_shared then raise exception 'FAIL: client sees unshared documents'; end if;
  p := public.portal_document_path('portal-firm-test', d_private);
  if p is not null then raise exception 'FAIL: private document path exposed'; end if;
  p := public.portal_document_path('portal-firm-test', d_shared);
  if p is null then raise exception 'FAIL: shared document path missing'; end if;

  -- No direct access to firm tables.
  select count(*) into n from public.clients where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: portal client can read clients table'; end if;
  select count(*) into n from public.matters where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: portal client can read matters table'; end if;
  select count(*) into n from public.documents where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: portal client can read documents table'; end if;

  -- Can message about their own matter; not as another client, not about another client's matter, not as the firm.
  insert into public.portal_messages (org_id, client_id, matter_id, sender, body, created_by) values (org_a, c1, m1, 'client', 'hello', client_user);
  begin
    insert into public.portal_messages (org_id, client_id, sender, body, created_by) values (org_a, c2, 'client', 'spoof', client_user);
    raise exception 'FAIL: client wrote as another client';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.portal_messages (org_id, client_id, matter_id, sender, body, created_by) values (org_a, c1, m2, 'client', 'x', client_user);
    raise exception 'FAIL: client attached another client''s matter';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.portal_messages (org_id, client_id, sender, body, created_by) values (org_a, c1, 'firm', 'fake firm', client_user);
    raise exception 'FAIL: client posted as firm';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.portal_messages where client_id = c2;
  if n <> 0 then raise exception 'FAIL: client reads other client messages'; end if;

  -- A stranger with the link sees nothing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated',
    'email', 'x-' || stranger || '@test.local')::text, true);
  execute 'set local role authenticated';
  perform public.portal_claim();
  j := public.portal_overview('portal-firm-test');
  if (j->>'authorized')::boolean then raise exception 'FAIL: stranger authorized'; end if;
  select count(*) into n from public.portal_messages where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: stranger reads portal messages'; end if;

  -- Revoked access stops working.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', lawyer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.portal_access set revoked_at = now() where org_id = org_a and client_id = c1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', client_user, 'role', 'authenticated',
    'email', 'client-' || client_user || '@test.local')::text, true);
  execute 'set local role authenticated';
  j := public.portal_overview('portal-firm-test');
  if (j->>'authorized')::boolean then raise exception 'FAIL: revoked client still authorized'; end if;

  execute 'reset role';
  raise exception 'PORTAL_ISOLATION_OK';
end $$;
