-- Integration connections (Zoho Bigin, Notion) through role-checked functions.
--
-- The table stays closed to direct access (RLS on, no policies, privileges
-- revoked in 0001). These SECURITY DEFINER functions are the only door, and
-- each checks the caller's role in the target firm. Tokens are always
-- AES-256-GCM ciphertext produced by the app server; the key never reaches
-- the database, so even a function caller only ever sees ciphertext.

create or replace function public.integration_list(p_org uuid)
returns table (provider text, status text, account_label text, connected_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select c.provider, c.status, c.account_label, c.connected_at, c.last_error
  from public.integration_connections c
  where c.org_id = p_org and public.is_member(p_org);
$$;

-- Any member may use a connection (e.g. a lawyer syncing a client).
create or replace function public.integration_get(p_org uuid, p_provider text)
returns table (encrypted_tokens text, api_domain text, status text)
language sql stable security definer set search_path = public as $$
  select c.encrypted_tokens, c.api_domain, c.status
  from public.integration_connections c
  where c.org_id = p_org and c.provider = p_provider and public.is_member(p_org);
$$;

-- Only owners/admins connect or replace a connection.
create or replace function public.integration_save(
  p_org uuid, p_provider text, p_tokens text, p_label text, p_api_domain text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_org, array['owner','admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_provider not in ('zoho_bigin', 'notion') or coalesce(p_tokens, '') = '' then
    raise exception 'invalid integration' using errcode = '22023';
  end if;
  insert into public.integration_connections
    (org_id, provider, status, encrypted_tokens, account_label, api_domain, connected_by, connected_at, last_error, updated_at)
  values (p_org, p_provider, 'connected', p_tokens, left(p_label, 200), left(p_api_domain, 200), auth.uid(), now(), null, now())
  on conflict (org_id, provider) do update set
    status = 'connected', encrypted_tokens = excluded.encrypted_tokens,
    account_label = excluded.account_label, api_domain = excluded.api_domain,
    connected_by = excluded.connected_by, connected_at = now(), last_error = null, updated_at = now();
end $$;

-- Members record refreshed tokens or an error while using a connection.
create or replace function public.integration_report(
  p_org uuid, p_provider text, p_status text, p_error text, p_tokens text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('connected', 'error') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.integration_connections set
    status = p_status,
    last_error = left(p_error, 300),
    encrypted_tokens = coalesce(nullif(p_tokens, ''), encrypted_tokens),
    updated_at = now()
  where org_id = p_org and provider = p_provider;
end $$;

create or replace function public.integration_delete(p_org uuid, p_provider text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_org, array['owner','admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.integration_connections where org_id = p_org and provider = p_provider;
end $$;

revoke all on function public.integration_list(uuid) from public, anon;
revoke all on function public.integration_get(uuid, text) from public, anon;
revoke all on function public.integration_save(uuid, text, text, text, text) from public, anon;
revoke all on function public.integration_report(uuid, text, text, text, text) from public, anon;
revoke all on function public.integration_delete(uuid, text) from public, anon;
grant execute on function public.integration_list(uuid) to authenticated;
grant execute on function public.integration_get(uuid, text) to authenticated;
grant execute on function public.integration_save(uuid, text, text, text, text) to authenticated;
grant execute on function public.integration_report(uuid, text, text, text, text) to authenticated;
grant execute on function public.integration_delete(uuid, text) to authenticated;
