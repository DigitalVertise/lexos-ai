-- 0006: firm branding, white-label client portal, avatar studio, assistant chat history.
-- Additive only. Tenant isolation stays in Postgres: every new table has RLS,
-- portal clients reach data only through role-checked functions/policies.

-- ---------------------------------------------------------------------------
-- 1. Firm branding
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists website_url text check (website_url is null or website_url ~ '^https://[^\s]{3,300}$'),
  add column if not exists logo_url text check (logo_url is null or logo_url ~ '^https://[^\s]{3,1000}$'),
  add column if not exists brand_colors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(brand_colors) = 'array' and jsonb_array_length(brand_colors) <= 12),
  add column if not exists brand_primary text check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists brand_accent text check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists theme text not null default 'auto' check (theme in ('light', 'dark', 'auto')),
  add column if not exists portal_slug text unique check (portal_slug is null or portal_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  add column if not exists portal_enabled boolean not null default false,
  add column if not exists portal_welcome text check (portal_welcome is null or char_length(portal_welcome) <= 600);

-- Owners/admins may edit branding (org_update policy already limits rows to them).
grant update (website_url, logo_url, brand_colors, brand_primary, brand_accent, theme,
              portal_slug, portal_enabled, portal_welcome) on public.organizations to authenticated;

-- Public bucket for logos only (portal visitors are not signed in).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy branding_write on storage.objects for insert to authenticated
  with check (bucket_id = 'branding'
              and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.org_role[]));
create policy branding_update on storage.objects for update to authenticated
  using (bucket_id = 'branding'
         and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.org_role[]));
create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding'
         and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- 2. Client portal
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists shared_with_client boolean not null default false;

create table if not exists public.portal_access (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (client_id, org_id) references public.clients(id, org_id) on delete cascade,
  unique (org_id, client_id, email)
);
create index if not exists portal_access_user_idx on public.portal_access(user_id) where revoked_at is null;
alter table public.portal_access enable row level security;

create or replace function public.is_portal_client(p_org uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_access
                 where org_id = p_org and client_id = p_client
                   and user_id = auth.uid() and revoked_at is null);
$$;

create policy portal_access_member_select on public.portal_access for select to authenticated
  using (public.is_member(org_id) or user_id = auth.uid());
create policy portal_access_insert on public.portal_access for insert to authenticated
  with check (public.has_role(org_id, array['owner','admin','lawyer']::public.org_role[]) and invited_by = auth.uid());
create policy portal_access_update on public.portal_access for update to authenticated
  using (public.has_role(org_id, array['owner','admin','lawyer']::public.org_role[]))
  with check (public.has_role(org_id, array['owner','admin','lawyer']::public.org_role[]));
create policy portal_access_delete on public.portal_access for delete to authenticated
  using (public.has_role(org_id, array['owner','admin','lawyer']::public.org_role[]));

-- A signed-in client links their account to invitations sent to their email.
create or replace function public.portal_claim()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.portal_access set user_id = auth.uid()
   where user_id is null and revoked_at is null
     and email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and coalesce((auth.jwt() ->> 'email_verified')::boolean, true);
  get diagnostics n = row_count;
  return n;
end $$;

-- Public branding of an enabled portal (anyone with the link).
create or replace function public.portal_brand(p_slug text)
returns table (slug text, name text, logo_url text, website_url text, brand_primary text,
               brand_accent text, theme text, portal_welcome text)
language sql stable security definer set search_path = public as $$
  select o.portal_slug, o.name, o.logo_url, o.website_url, o.brand_primary, o.brand_accent, o.theme, o.portal_welcome
  from public.organizations o where o.portal_slug = lower(p_slug) and o.portal_enabled;
$$;

-- Everything a signed-in client may see on this firm's portal, as JSON.
create or replace function public.portal_overview(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_clients uuid[];
begin
  select id into v_org from public.organizations where portal_slug = lower(p_slug) and portal_enabled;
  if v_org is null or auth.uid() is null then return null; end if;
  select array_agg(client_id) into v_clients from public.portal_access
   where org_id = v_org and user_id = auth.uid() and revoked_at is null;
  if v_clients is null then return jsonb_build_object('authorized', false); end if;
  return jsonb_build_object(
    'authorized', true,
    'org_id', v_org,
    'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]')
                from public.clients c where c.org_id = v_org and c.id = any(v_clients)),
    'matters', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', m.id, 'number', m.number, 'title', m.title, 'status', m.status,
                  'matter_type', m.matter_type, 'opened_on', m.opened_on, 'client_id', m.client_id)
                  order by m.number desc), '[]')
                from public.matters m where m.org_id = v_org and m.client_id = any(v_clients)),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', d.id, 'title', d.title, 'matter_id', d.matter_id, 'source', d.source,
                  'url', case when d.source = 'link' then d.url end,
                  'mime_type', d.mime_type, 'created_at', d.created_at)
                  order by d.created_at desc), '[]')
                from public.documents d join public.matters m on m.id = d.matter_id and m.org_id = d.org_id
                where d.org_id = v_org and d.shared_with_client and m.client_id = any(v_clients)),
    'messages', (select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') from (
                  select jsonb_build_object('id', pm.id, 'sender', pm.sender, 'body', pm.body,
                                            'matter_id', pm.matter_id, 'created_at', pm.created_at) x
                  from public.portal_messages pm
                  where pm.org_id = v_org and pm.client_id = any(v_clients)
                  order by pm.created_at desc limit 50) t)
  );
end $$;

-- Portals the signed-in client has access to (for sign-in routing).
create or replace function public.portal_my_portals()
returns table (slug text, name text)
language sql stable security definer set search_path = public as $$
  select distinct o.portal_slug, o.name
  from public.portal_access pa join public.organizations o on o.id = pa.org_id
  where pa.user_id = auth.uid() and pa.revoked_at is null and o.portal_enabled and o.portal_slug is not null;
$$;

-- Storage path of a shared document the signed-in client may download (or null).
create or replace function public.portal_document_path(p_slug text, p_document uuid)
returns text language sql stable security definer set search_path = public as $$
  select d.storage_path
  from public.documents d
  join public.matters m on m.id = d.matter_id and m.org_id = d.org_id
  join public.organizations o on o.id = d.org_id and o.portal_slug = lower(p_slug) and o.portal_enabled
  where d.id = p_document and d.shared_with_client and d.source = 'upload'
    and public.is_portal_client(d.org_id, m.client_id);
$$;

-- Clients may read shared files directly from storage (signed URL created with their session).
create policy documents_portal_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d
    join public.matters m on m.id = d.matter_id and m.org_id = d.org_id
    where d.storage_path = name and d.shared_with_client
      and public.is_portal_client(d.org_id, m.client_id)));

create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  matter_id uuid,
  sender text not null check (sender in ('client', 'firm')),
  body text not null check (char_length(body) between 1 and 5000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (client_id, org_id) references public.clients(id, org_id) on delete cascade,
  foreign key (matter_id, org_id) references public.matters(id, org_id) on delete cascade
);
create index if not exists portal_messages_client_idx on public.portal_messages(org_id, client_id, created_at desc);
alter table public.portal_messages enable row level security;

create or replace function public.matter_belongs_to_client(p_org uuid, p_matter uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_matter is null or exists (select 1 from public.matters
                                     where id = p_matter and org_id = p_org and client_id = p_client);
$$;

create policy portal_messages_select on public.portal_messages for select to authenticated
  using (public.is_member(org_id) or public.is_portal_client(org_id, client_id));
create policy portal_messages_firm_insert on public.portal_messages for insert to authenticated
  with check (sender = 'firm' and created_by = auth.uid() and public.is_member(org_id)
              and public.matter_belongs_to_client(org_id, matter_id, client_id));
create policy portal_messages_client_insert on public.portal_messages for insert to authenticated
  with check (sender = 'client' and created_by = auth.uid() and public.is_portal_client(org_id, client_id)
              and public.matter_belongs_to_client(org_id, matter_id, client_id));
create policy portal_messages_mark_read on public.portal_messages for update to authenticated
  using (public.is_member(org_id)) with check (public.is_member(org_id));
revoke update on public.portal_messages from authenticated;
grant update (read_at) on public.portal_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Avatar studio
-- ---------------------------------------------------------------------------
alter table public.agent_hires
  add column if not exists avatar jsonb check (avatar is null or (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) < 8192));

alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('zoho_bigin', 'notion', 'heygen', 'elevenlabs', 'did', 'simli', 'livetalking'));

create or replace function public.integration_save(
  p_org uuid, p_provider text, p_tokens text, p_label text, p_api_domain text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_org, array['owner','admin']::public.org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_provider not in ('zoho_bigin', 'notion', 'heygen', 'elevenlabs', 'did', 'simli', 'livetalking')
     or coalesce(p_tokens, '') = '' then
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

-- ---------------------------------------------------------------------------
-- 4. Assistant chat history (private to the person chatting; admins can review)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  hire_id uuid not null,
  conversation_id uuid not null,
  matter_id uuid,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 60000),
  mode text not null default 'chat' check (mode in ('chat', 'voice', 'avatar')),
  model text,
  input_tokens integer,
  output_tokens integer,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (hire_id, org_id) references public.agent_hires(id, org_id) on delete cascade,
  foreign key (matter_id, org_id) references public.matters(id, org_id) on delete cascade
);
create index if not exists agent_messages_conv_idx on public.agent_messages(org_id, conversation_id, created_at);
create index if not exists agent_messages_usage_idx on public.agent_messages(org_id, created_at) where role = 'assistant';
alter table public.agent_messages enable row level security;

create policy agent_messages_select on public.agent_messages for select to authenticated
  using (public.is_member(org_id)
         and (created_by = auth.uid() or public.has_role(org_id, array['owner','admin']::public.org_role[])));
create policy agent_messages_insert on public.agent_messages for insert to authenticated
  with check (public.is_member(org_id) and created_by = auth.uid());
revoke update, delete on public.agent_messages from authenticated;

-- Firm-wide monthly usage (assistant replies), readable by every member for package limits.
create or replace function public.chat_replies_since(p_org uuid, p_since timestamptz)
returns integer language sql stable security definer set search_path = public as $$
  select case when public.is_member(p_org)
    then (select count(*)::int from public.agent_messages where org_id = p_org and role = 'assistant' and created_at >= p_since)
    else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.portal_access, public.portal_messages, public.agent_messages from anon;
revoke all on function public.portal_overview(text) from public, anon;
revoke all on function public.portal_document_path(text, uuid) from public, anon;
revoke all on function public.portal_claim() from public, anon;
revoke all on function public.portal_my_portals() from public, anon;
revoke all on function public.is_portal_client(uuid, uuid) from public, anon;
revoke all on function public.matter_belongs_to_client(uuid, uuid, uuid) from public, anon;
revoke all on function public.chat_replies_since(uuid, timestamptz) from public, anon;
grant execute on function public.portal_overview(text), public.portal_document_path(text, uuid),
  public.portal_claim(), public.portal_my_portals(), public.is_portal_client(uuid, uuid),
  public.matter_belongs_to_client(uuid, uuid, uuid), public.chat_replies_since(uuid, timestamptz) to authenticated;
grant execute on function public.portal_brand(text) to anon, authenticated;
