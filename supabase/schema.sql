create table if not exists public.qr_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  client_name text not null default '',
  destination_url text not null,
  active boolean not null default true,
  scan_count integer not null default 0 check (scan_count >= 0),
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qr_codes_code_case_insensitive_key
  on public.qr_codes (upper(code));

alter table public.qr_admins enable row level security;
alter table public.qr_codes enable row level security;

revoke all on public.qr_admins from anon, authenticated;
grant select on public.qr_admins to authenticated;
revoke all on public.qr_codes from anon, authenticated;
grant select, insert, update, delete on public.qr_codes to authenticated;

drop policy if exists qr_admins_read_own_membership on public.qr_admins;
create policy qr_admins_read_own_membership
  on public.qr_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists qr_codes_admin_manage on public.qr_codes;
drop policy if exists "Admin only access" on public.qr_codes;
create policy qr_codes_admin_manage
  on public.qr_codes for all to authenticated
  using (
    exists (
      select 1 from public.qr_admins as admins
      where admins.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.qr_admins as admins
      where admins.user_id = (select auth.uid())
    )
  );

create or replace function public.resolve_qr_code(p_code text)
returns table (destination_url text, active boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target public.qr_codes%rowtype;
begin
  select qr.*
    into target
    from public.qr_codes as qr
   where upper(qr.code) = upper(trim(p_code))
   limit 1;

  if not found then
    return;
  end if;

  if target.active then
    update public.qr_codes as qr
       set scan_count = qr.scan_count + 1,
           last_scan_at = now(),
           updated_at = now()
     where qr.id = target.id;
  end if;

  return query
    select case when target.active then target.destination_url else null end,
           target.active;
end;
$function$;

revoke all on function public.resolve_qr_code(text) from public;
grant execute on function public.resolve_qr_code(text) to anon, authenticated;