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

-- Per-user settings. time_zone lets the Shortcut work out what "today" and "fri" mean.
create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  time_zone  text not null default 'America/New_York',
  updated_at timestamptz not null default now()
);

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
alter table public.user_settings enable row level security;

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

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
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

-- Quick-entry syntax. Details typed at the end of a capture fill in fields:
--   'Call dentist fri !high #health' -> due Friday, High priority, Health area.
-- Only trailing words are read. js/parse.js has the same rules for the app.
create or replace function public.parse_capture(
  p_text text, p_today date,
  out title text, out next_due date, out priority text, out area text)
language plpgsql
immutable
as $$
declare
  words text[] := regexp_split_to_array(btrim(coalesce(p_text, '')), '\s+');
  n     int := array_length(words, 1);
  w     text;
  wd    int;
  d     date;
  m     text[];
  y     int;
begin
  title := btrim(coalesce(p_text, ''));
  while n > 1 loop
    w := lower(words[n]);
    -- Priority, e.g. !high or a lone ! for High.
    if priority is null and w in ('!', '!high', '!critical', '!crit', '!low', '!someday', '!normal') then
      priority := case w when '!' then 'High' when '!crit' then 'Critical' else initcap(substr(w, 2)) end;
      n := n - 1; continue;
    end if;
    -- Area, e.g. #health.
    if area is null and w in ('#home', '#health', '#finance', '#family', '#projects', '#work') then
      area := initcap(substr(w, 2));
      n := n - 1; continue;
    end if;
    -- Due date: today, tomorrow, a weekday, or m/d[/yy].
    if next_due is null then
      d := null;
      if w in ('today', 'tod') then d := p_today;
      elsif w in ('tomorrow', 'tmrw', 'tmr') then d := p_today + 1;
      else
        w := regexp_replace(w, '\.$', '');
        wd := array_position(array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], left(w, 3)) - 1;
        if wd is not null and length(w) >= 3 and (length(w) = 3 or w in ('tues', 'thur', 'thurs')
            or position(w in 'sunday monday tuesday wednesday thursday friday saturday') > 0) then
          d := p_today + ((wd - extract(dow from p_today)::int + 7) % 7);
        else
          m := regexp_match(w, '^(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?$');
          if m is not null then
            y := coalesce(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, extract(year from p_today)::int);
            begin
              d := make_date(y, m[1]::int, m[2]::int);
              if m[3] is null and d < p_today then
                d := make_date(y + 1, m[1]::int, m[2]::int);
              end if;
            exception when others then
              null; -- an invalid date leaves d null; 2/29 with no next-year match keeps this year's date
            end;
          end if;
        end if;
      end if;
      if d is not null then next_due := d; n := n - 1; continue; end if;
    end if;
    exit;
  end loop;
  if next_due is not null then
    while n > 1 and lower(words[n]) in ('on', 'by', 'due') loop n := n - 1; end loop;
  end if;
  if n < coalesce(array_length(words, 1), 0) then
    title := array_to_string(words[1:n], ' ');
  end if;
end;
$$;

-- Called by the iPhone Shortcut. Can only add an item, never read anything.
-- p_type is Inbox, Action, Project, Idea, Responsibility or Work (an Action in the Work area).
create or replace function public.capture(p_key text, p_title text, p_type text default 'Inbox')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid   uuid;
  t     text;
  a     text;
  tz    text;
  today date;
  p     record;
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
  if t = 'Work' then
    t := 'Action';
    a := 'Work';
  elsif t is not null and t not in ('Action', 'Project', 'Idea', 'Responsibility') then
    t := null;
  end if;
  select time_zone into tz from public.user_settings where user_id = uid;
  begin
    today := (now() at time zone coalesce(tz, 'America/New_York'))::date;
  exception when others then
    today := (now() at time zone 'America/New_York')::date;
  end;
  p := public.parse_capture(p_title, today);
  insert into public.items (user_id, title, type, stage, next_due, priority, area)
  values (uid, left(p.title, 500), t, case when t is null then 'New' else 'Ready' end,
          p.next_due, coalesce(p.priority, 'Normal'), coalesce(p.area, a));
  return 'Saved to ' || case when a = 'Work' then 'Work' else coalesce(t, 'Inbox') end
    || case when p.next_due is not null then ', due ' || to_char(p.next_due, 'Dy FMMon FMDD') else '' end
    || case when p.priority is not null then ', ' || p.priority else '' end;
end;
$$;

revoke all on function public.new_capture_key() from public, anon;
grant execute on function public.new_capture_key() to authenticated;
revoke all on function public.parse_capture(text, date) from public, anon;
grant execute on function public.parse_capture(text, date) to authenticated;
revoke all on function public.capture(text, text, text) from public;
grant execute on function public.capture(text, text, text) to anon, authenticated;
