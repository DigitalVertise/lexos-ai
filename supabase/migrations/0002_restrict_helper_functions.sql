-- Membership helpers are only needed by signed-in users' RLS policies.
revoke execute on function public.is_member(uuid) from anon, public;
revoke execute on function public.has_role(uuid, public.org_role[]) from anon, public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.org_role[]) to authenticated;
