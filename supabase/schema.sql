-- Personal OS database setup.
-- Paste this whole file into Supabase: SQL Editor > New query > Run.
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- Items: actions, projects, ideas, responsibilities, and inbox captures.
create table if not exists public.items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title           text not null,
  type            text check (type in ('Action', 'Project', 'Idea', 'Responsibility')),
  stage           text not null default 'New'
                  check (stage in ('New', 'Seed', 'Exploring', 'Planned', 'Ready', 'Active', 'Waiting', 'Complete')),
  priority        text not null default 'Normal'
                  check (priority in ('Critical', 'High', 'Normal', 'Low', 'Someday')),
  focus           boolean not null default false,
  next_action     text,
  last_action     text,
  desired_outcome text,
  waiting_on      text,
  next_due        date,
  completed_date  date,
  parent_id       uuid references public.items (id) on delete set null,
  area            text,
  frequency       text check (frequency in ('Daily', 'Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Semiannual', 'Annual', 'Custom')),
  interval_days   integer,
  plan            text,
  cleared_at      timestamptz,
  sort_order      integer,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists items_user_idx on public.items (user_id);
create index if not exists items_parent_idx on public.items (parent_id);

-- One free-form note per day.
create table if not exists public.daily_notes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day        date not null,
  body       text not null default '',
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Dated entries in a project's activity log.
create table if not exists public.project_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.items (id) on delete cascade,
  day        date not null,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists project_log_project_idx on public.project_log (project_id);

-- Today's pad lines. Unfinished ones carry over to the next day.
create table if not exists public.pad_jots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day          date not null,
  text         text not null,
  done         boolean not null default false,
  carried_from date,
  removed_at   timestamptz,
  cleared_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists pad_jots_user_day_idx on public.pad_jots (user_id, day);

-- Hashed key the iPhone Shortcut uses. Never readable from the app.
create table if not exists public.capture_keys (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);

-- Every row belongs to the signed-in user and nobody else.
alter table public.items        enable row level security;
alter table public.daily_notes  enable row level security;
alter table public.project_log  enable row level security;
alter table public.pad_jots     enable row level security;
alter table public.capture_keys enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own notes" on public.daily_notes;
create policy "own notes" on public.daily_notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own log" on public.project_log;
create policy "own log" on public.project_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own jots" on public.pad_jots;
create policy "own jots" on public.pad_jots
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- capture_keys has no policies on purpose: only the functions below touch it.

-- Make a new Shortcut key for the signed-in user. Returns it once; only its hash is stored.
create or replace function public.new_capture_key()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  k := encode(gen_random_bytes(24), 'hex');
  insert into public.capture_keys (user_id, key_hash)
  values (auth.uid(), encode(digest(k, 'sha256'), 'hex'))
  on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end;
$$;

-- Called by the iPhone Shortcut. Can only add an item, never read anything.
create or replace function public.capture(p_key text, p_title text, p_type text default 'Inbox')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  t   text;
begin
  select user_id into uid from public.capture_keys
  where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if uid is null then
    raise exception 'Invalid capture key';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Nothing to save';
  end if;
  t := nullif(btrim(coalesce(p_type, 'Inbox')), 'Inbox');
  if t is not null and t not in ('Action', 'Project', 'Idea', 'Responsibility') then
    t := null;
  end if;
  insert into public.items (user_id, title, type, stage)
  values (uid, left(btrim(p_title), 500), t, case when t is null then 'New' else 'Ready' end);
  return 'Saved to ' || coalesce(t, 'Inbox');
end;
$$;

revoke all on function public.new_capture_key() from public, anon;
grant execute on function public.new_capture_key() to authenticated;
revoke all on function public.capture(text, text, text) from public;
grant execute on function public.capture(text, text, text) to anon, authenticated;
