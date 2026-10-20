-- Tenant-isolation test, run against the real database.
-- Everything happens inside one DO block that always ends by raising an
-- exception, so nothing is ever committed. Success = the final message
-- "TENANT_ISOLATION_OK"; any other error message names the failed check.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  org_a uuid; org_b uuid; client_a uuid; matter_a uuid; n int; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a-' || a || '@test.local', now(), '{}'),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b-' || b || '@test.local', now(), '{}');

  -- User A creates a firm, a client and a matter.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  org_a := public.create_organization('Firm A', 'Alice');
  insert into public.clients (org_id, name, created_by) values (org_a, 'Client A', a) returning id into client_a;
  insert into public.matters (org_id, number, client_id, title, created_by) values (org_a, 999, client_a, 'Matter A', a) returning id into matter_a;
  select number into n from public.matters where id = matter_a;
  if n <> 1 then raise exception 'FAIL: matter number not assigned by database (got %)', n; end if;
  insert into public.agent_hires (org_id, agent_key, name, hired_by) values (org_a, 'drafting_associate', 'Drafting Associate', a);

  -- User A cannot change billing columns.
  begin
    update public.organizations set plan = 'pro' where id = org_a;
    raise exception 'FAIL: user could change plan';
  exception when insufficient_privilege then null;
  end;

  -- User B creates their own firm.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  org_b := public.create_organization('Firm B', 'Bob');

  -- B sees nothing of A.
  select count(*) into n from public.organizations where id = org_a;
  if n <> 0 then raise exception 'FAIL: B can see A organization'; end if;
  select count(*) into n from public.clients where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: B can see A clients'; end if;
  select count(*) into n from public.matters where id = matter_a;
  if n <> 0 then raise exception 'FAIL: B can see A matter by id'; end if;
  select count(*) into n from public.agent_hires where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: B can see A assistants'; end if;
  select count(*) into n from public.memberships where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: B can see A members'; end if;

  -- B cannot write into A's firm, even by supplying A's org_id.
  begin
    insert into public.clients (org_id, name, created_by) values (org_a, 'Injected', b);
    raise exception 'FAIL: B inserted into A';
  exception when insufficient_privilege then null;
  end;

  -- B cannot link A's client to a matter in B's firm (composite foreign key).
  begin
    insert into public.matters (org_id, number, client_id, title, created_by) values (org_b, 0, client_a, 'Cross-tenant', b);
    raise exception 'FAIL: cross-tenant client link allowed';
  exception when foreign_key_violation then null;
  end;

  -- B's update/delete of A's rows affects nothing.
  update public.matters set title = 'Hacked' where id = matter_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A matter'; end if;
  delete from public.clients where id = client_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A client'; end if;

  -- B cannot add themselves to A's firm.
  begin
    insert into public.memberships (org_id, user_id, role) values (org_a, b, 'owner');
    raise exception 'FAIL: B joined A';
  exception when insufficient_privilege then null;
  end;

  -- Server-only tables are closed to users.
  begin
    perform 1 from public.integration_connections;
    raise exception 'FAIL: integration_connections readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.stripe_events;
    raise exception 'FAIL: stripe_events readable';
  exception when insufficient_privilege then null;
  end;

  -- Storage policy helper: B is not a member of A.
  select public.is_member(org_a) into ok;
  if ok then raise exception 'FAIL: is_member true for non-member'; end if;

  raise exception 'TENANT_ISOLATION_OK';
end $$;
