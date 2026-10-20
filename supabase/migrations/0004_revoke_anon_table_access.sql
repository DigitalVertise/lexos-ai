-- Signed-out visitors never need direct table access (RLS already returns nothing; this closes it outright).
revoke all on public.organizations, public.memberships, public.invitations, public.clients, public.matters,
  public.tasks, public.documents, public.ai_outputs, public.audit_events, public.agent_hires from anon;
