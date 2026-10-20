-- LexOS AI — initial schema.
-- Tenant isolation is enforced by Postgres row-level security (RLS): every
-- business row carries org_id and is visible only to members of that org.
-- Composite foreign keys (id, org_id) make cross-tenant links impossible.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Organizations and memberships
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  country text default 'AE',
  default_jurisdiction text default 'UAE',
  -- Billing state: written only by the server (Stripe webhook), never by users.
  plan text not null default 'trial' check (plan in ('trial', 'basic', 'pro', 'none')),
  subscription_status text not null default 'trialing',
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'lawyer', 'staff');

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'lawyer',
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.org_role not null default 'lawyer' check (role <> 'owner'),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
create index invitations_email_idx on public.invitations(lower(email));

-- Membership helpers. SECURITY DEFINER so policies can call them without
-- recursing into memberships' own RLS.
create or replace function public.is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships
                 where org_id = target_org and user_id = auth.uid());
$$;

create or replace function public.has_role(target_org uuid, roles public.org_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships
                 where org_id = target_org and user_id = auth.uid() and role = any(roles));
$$;

-- ---------------------------------------------------------------------------
-- Clients, matters, tasks, documents
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'individual' check (kind in ('individual', 'organization')),
  name text not null check (char_length(name) between 1 and 200),
  email text,
  phone text,
  address text,
  notes text,
  -- CRM mapping (Zoho Bigin)
  crm_id text,
  crm_sync_status text not null default 'not_synced'
    check (crm_sync_status in ('not_synced', 'pending', 'synced', 'failed')),
  crm_synced_at timestamptz,
  crm_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, crm_id)
);
create index clients_org_name_idx on public.clients(org_id, lower(name));

create table public.matters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number integer not null,
  client_id uuid not null,
  title text not null check (char_length(title) between 1 and 300),
  matter_type text,
  jurisdiction text,
  status text not null default 'open' check (status in ('intake', 'open', 'on_hold', 'closed')),
  responsible_user_id uuid references auth.users(id),
  description text,
  opened_on date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, number),
  foreign key (client_id, org_id) references public.clients(id, org_id) on delete restrict
);
create index matters_org_status_idx on public.matters(org_id, status);

-- Per-organization matter numbers (M-1, M-2...).
create or replace function public.assign_matter_number()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Always assigned by the database; a client-supplied number is ignored.
  perform pg_advisory_xact_lock(hashtext(new.org_id::text));
  select coalesce(max(number), 0) + 1 into new.number
    from public.matters where org_id = new.org_id;
  return new;
end $$;
create trigger matters_number before insert on public.matters
  for each row execute function public.assign_matter_number();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  matter_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done')),
  assignee_id uuid references auth.users(id),
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (matter_id, org_id) references public.matters(id, org_id) on delete cascade
);
create index tasks_org_due_idx on public.tasks(org_id, status, due_at);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  matter_id uuid not null,
  title text not null check (char_length(title) between 1 and 300),
  source text not null check (source in ('upload', 'link')),
  storage_path text,       -- private bucket path: {org_id}/{document_id}/{filename}
  url text,                -- for links (e.g. a Notion page)
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes <= 26214400),
  status text not null default 'draft' check (status in ('draft', 'final', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (matter_id, org_id) references public.matters(id, org_id) on delete cascade,
  check ((source = 'upload' and storage_path is not null) or (source = 'link' and url is not null))
);
create index documents_matter_idx on public.documents(org_id, matter_id);

-- ---------------------------------------------------------------------------
-- AI outputs and usage
-- ---------------------------------------------------------------------------

create table public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  matter_id uuid,
  workflow text not null,
  instructions text,       -- the user's request (not the full assembled prompt)
  output text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (matter_id, org_id) references public.matters(id, org_id) on delete cascade
);
create index ai_outputs_org_created_idx on public.ai_outputs(org_id, created_at desc);
create index ai_outputs_user_created_idx on public.ai_outputs(created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_org_created_idx on public.audit_events(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Server-only tables (no user access at all; used with the service role)
-- ---------------------------------------------------------------------------

create table public.integration_connections (
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('zoho_bigin', 'notion')),
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  encrypted_tokens text not null,  -- AES-256-GCM, key held only by the server
  account_label text,
  api_domain text,
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
create trigger matters_touch before update on public.matters for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.clients enable row level security;
alter table public.matters enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.ai_outputs enable row level security;
alter table public.audit_events enable row level security;
alter table public.integration_connections enable row level security;
alter table public.stripe_events enable row level security;

-- Organizations: members read; owners/admins may rename. Billing columns are
-- not updatable by users at all (column privileges below).
create policy org_select on public.organizations for select to authenticated
  using (public.is_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_role(id, array['owner','admin']::public.org_role[]))
  with check (public.has_role(id, array['owner','admin']::public.org_role[]));
revoke insert, update, delete on public.organizations from authenticated, anon;
grant update (name, country, default_jurisdiction) on public.organizations to authenticated;

-- Memberships: members see their colleagues; owners/admins manage.
create policy mem_select on public.memberships for select to authenticated
  using (public.is_member(org_id));
create policy mem_update on public.memberships for update to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_role(org_id, array['owner','admin']::public.org_role[]) and role <> 'owner');
create policy mem_delete on public.memberships for delete to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]) and role <> 'owner');
revoke insert on public.memberships from authenticated, anon;

-- Invitations: owners/admins manage; invitees accept via accept_invitation().
create policy inv_select on public.invitations for select to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]));
create policy inv_insert on public.invitations for insert to authenticated
  with check (public.has_role(org_id, array['owner','admin']::public.org_role[]) and invited_by = auth.uid());
create policy inv_delete on public.invitations for delete to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]));

-- Business tables: any member reads and writes; deletes limited by role.
do $$
declare t text;
begin
  foreach t in array array['clients','matters','tasks','documents'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(org_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_member(org_id) and created_by = auth.uid())', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id))', t);
    execute format($p$create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_role(org_id, array['owner','admin','lawyer']::public.org_role[]))$p$, t);
  end loop;
end $$;

create policy ai_select on public.ai_outputs for select to authenticated
  using (public.is_member(org_id));
create policy ai_insert on public.ai_outputs for insert to authenticated
  with check (public.is_member(org_id) and created_by = auth.uid());

create policy audit_select on public.audit_events for select to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]));
create policy audit_insert on public.audit_events for insert to authenticated
  with check (public.is_member(org_id) and actor_id = auth.uid());
revoke update, delete on public.audit_events from authenticated, anon;

-- integration_connections and stripe_events: RLS on, no policies => no access
-- for anon/authenticated. Only the service role (server) can touch them.
revoke all on public.integration_connections from authenticated, anon;
revoke all on public.stripe_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create an organization with the caller as owner (one call, atomic).
create or replace function public.create_organization(org_name text, member_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.organizations(name) values (trim(org_name)) returning id into new_org;
  insert into public.memberships(org_id, user_id, role, full_name, email)
    values (new_org, auth.uid(), 'owner', member_name,
            (select email from auth.users where id = auth.uid()));
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id)
    values (new_org, auth.uid(), 'organization.created', 'organization', new_org::text);
  return new_org;
end $$;

-- Accept a pending invitation addressed to the caller's verified email.
create or replace function public.accept_invitation(invitation uuid, member_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invitations; caller_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into caller_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  select * into inv from public.invitations where id = invitation for update;
  if inv.id is null or inv.accepted_at is not null or inv.expires_at < now()
     or lower(inv.email) <> lower(coalesce(caller_email, '')) then
    raise exception 'invitation not valid for this account';
  end if;
  insert into public.memberships(org_id, user_id, role, full_name, email)
    values (inv.org_id, auth.uid(), inv.role, member_name, caller_email)
    on conflict (org_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = inv.id;
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id)
    values (inv.org_id, auth.uid(), 'invitation.accepted', 'invitation', inv.id::text);
  return inv.org_id;
end $$;

-- Pending invitations for the caller (so they can see and accept them).
create or replace function public.my_invitations()
returns table (id uuid, org_id uuid, org_name text, role public.org_role, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.org_id, o.name, i.role, i.expires_at
  from public.invitations i join public.organizations o on o.id = i.org_id
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null
  where lower(i.email) = lower(u.email) and i.accepted_at is null and i.expires_at > now();
$$;

revoke execute on function public.create_organization(text, text) from anon, public;
revoke execute on function public.accept_invitation(uuid, text) from anon, public;
revoke execute on function public.my_invitations() from anon, public;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.accept_invitation(uuid, text) to authenticated;
grant execute on function public.my_invitations() to authenticated;

-- ---------------------------------------------------------------------------
-- Private document storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/png',
  'image/jpeg'
]) on conflict (id) do nothing;

-- Objects live under {org_id}/...; only members of that org can read/write.
create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and public.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin','lawyer']::public.org_role[]));
