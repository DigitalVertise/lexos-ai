-- AI legal assistants ("virtual employees") that a firm hires per package.

create table public.agent_hires (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Catalog key (e.g. 'drafting_associate') or 'custom' for a Pro custom assistant.
  agent_key text not null check (agent_key ~ '^[a-z_]{3,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  -- Firm-specific instructions (house style, preferred language...). For a
  -- custom assistant this is its whole role description.
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  status text not null default 'active' check (status in ('active', 'paused')),
  hired_by uuid references auth.users(id),
  hired_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index agent_hires_catalog_once
  on public.agent_hires(org_id, agent_key) where agent_key <> 'custom';

alter table public.agent_hires enable row level security;
create policy hires_select on public.agent_hires for select to authenticated
  using (public.is_member(org_id));
-- Hiring, editing and letting go of assistants: owners and admins.
-- Package limits are enforced by the server before these writes.
create policy hires_insert on public.agent_hires for insert to authenticated
  with check (public.has_role(org_id, array['owner','admin']::public.org_role[]) and hired_by = auth.uid());
create policy hires_update on public.agent_hires for update to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_role(org_id, array['owner','admin']::public.org_role[]));
create policy hires_delete on public.agent_hires for delete to authenticated
  using (public.has_role(org_id, array['owner','admin']::public.org_role[]));

alter table public.ai_outputs add column agent_hire_id uuid;
alter table public.ai_outputs add column agent_key text;
alter table public.ai_outputs
  add constraint ai_outputs_hire_fk foreign key (agent_hire_id, org_id)
  references public.agent_hires(id, org_id) on delete set null (agent_hire_id);
create index ai_outputs_org_month_idx on public.ai_outputs(org_id, created_at);
