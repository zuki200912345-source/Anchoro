-- Anchor: full schema, RLS, views, triggers.
-- Run once against a fresh Supabase project.

create type category as enum
  ('spatial', 'problem_solving', 'pattern', 'logic', 'memory', 'mental_math');
create type session_type as enum ('daily', 'practice', 'challenge');
create type session_status as enum ('not_started', 'in_progress', 'complete');
create type friendship_status as enum ('pending', 'accepted');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_emoji text,
  school text,
  year_group text,
  friend_code text not null unique,
  timezone text not null default 'UTC',
  reminder_time time,
  public_leaderboard boolean not null default true,
  xp integer not null default 0,
  level integer not null default 0,
  streak_current integer not null default 0,
  streak_longest integer not null default 0,
  streak_freezes integer not null default 0,
  last_session_date date,
  -- 400 is what the recency-weighted formula yields for six fresh 1000
  -- ratings; seeding 1000 here would rank untested accounts at the top.
  cognitive_score integer not null default 400,
  referred_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table category_ratings (
  user_id uuid not null references profiles (id) on delete cascade,
  category category not null,
  rating integer not null default 1000,
  puzzles_seen integer not null default 0,
  correct_count integer not null default 0,
  median_time_ms integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type session_type not null,
  date date not null,
  puzzle_seeds jsonb not null,
  status session_status not null default 'in_progress',
  score integer,
  xp_earned integer not null default 0,
  accuracy real,
  hints_used integer not null default 0,
  -- server-side record of hint tiers served, keyed by puzzle seed; the
  -- attempt route trusts this over anything the client reports
  hint_log jsonb not null default '{}'::jsonb,
  -- cognitive score snapshot at completion; feeds the score-over-time chart
  cognitive_score_after integer,
  -- AI recap paragraph, written once at completion
  feedback text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index sessions_one_daily_per_day
  on sessions (user_id, date) where (type = 'daily');
create index sessions_user_date on sessions (user_id, date);

-- set after the challenges table exists (below)
-- alter table sessions add column challenge_id;

create table attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  puzzle_type text not null,
  category category not null,
  difficulty integer not null,
  seed text not null,
  correct boolean not null,
  time_ms integer not null,
  hints_used integer not null default 0,
  attempts integer not null default 1,
  answer jsonb,
  rating_delta integer not null default 0,
  created_at timestamptz not null default now()
);

create index attempts_user_category on attempts (user_id, category);
create index attempts_user_seed on attempts (user_id, seed);
-- One graded answer per puzzle slot: closes the double-submit race.
create unique index attempts_one_per_slot on attempts (session_id, seed);

create table achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  achievement_key text not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_key)
);

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id) on delete cascade,
  addressee_id uuid not null references profiles (id) on delete cascade,
  status friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  creator_id uuid not null references profiles (id) on delete cascade,
  category category not null,
  difficulty integer not null,
  puzzle_seeds jsonb not null,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create index challenges_code on challenges (code);

alter table sessions
  add column challenge_id uuid references challenges (id) on delete set null;

create table challenge_results (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  score integer not null,
  time_ms integer not null,
  completed_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create table hint_cache (
  id uuid primary key default gen_random_uuid(),
  puzzle_type text not null,
  seed text not null,
  tier integer not null,
  hint_text text not null,
  created_at timestamptz not null default now(),
  unique (puzzle_type, seed, tier)
);

create index profiles_school on profiles (school);
create index profiles_cognitive_score on profiles (cognitive_score desc);

-- ---------------------------------------------------------------------------
-- New-user bootstrap: skeleton profile with a unique friend code, plus the
-- six rating rows. Onboarding fills in the rest. Referral codes arrive in
-- auth metadata as `ref` and credit the referrer 50 xp.
-- ---------------------------------------------------------------------------

create or replace function generate_friend_code() returns text
language plpgsql as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from profiles where friend_code = code);
  end loop;
  return code;
end;
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  referrer uuid;
begin
  select id into referrer from profiles
    where friend_code = upper(coalesce(new.raw_user_meta_data ->> 'ref', ''));

  insert into profiles (id, friend_code, referred_by)
    values (new.id, generate_friend_code(), referrer);

  insert into category_ratings (user_id, category)
    select new.id, c from unnest(enum_range(null::category)) as c;

  if referrer is not null then
    -- Level is a pure function of xp (§6), so recompute it with the bonus.
    update profiles
      set xp = xp + 50,
          level = floor(sqrt((xp + 50) / 100.0))::int
      where id = referrer;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Leaderboard surfaces. The public view exposes only the allowed columns for
-- opted-in profiles; weekly XP comes from a materialised view refreshed after
-- session completion.
-- ---------------------------------------------------------------------------

create view leaderboard_view as
  select id, display_name, avatar_emoji, school, xp, cognitive_score,
         streak_current
  from profiles
  where public_leaderboard = true and display_name is not null;

create materialized view weekly_xp_mv as
  select user_id, sum(xp_earned)::integer as xp
  from sessions
  where completed_at >= date_trunc('week', now())
  group by user_id;

create unique index weekly_xp_mv_user on weekly_xp_mv (user_id);

-- RLS cannot apply to a materialised view, so clients never read it directly.
-- This wrapper is the only public weekly surface and honours the opt-out.
create view weekly_leaderboard as
  select m.user_id, m.xp
  from weekly_xp_mv m
  join profiles p on p.id = m.user_id
  where p.public_leaderboard = true and p.display_name is not null;

create or replace function refresh_weekly_xp() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently weekly_xp_mv;
end;
$$;

create or replace function lookup_friend_code(code text)
returns table (id uuid, display_name text, avatar_emoji text)
language sql security definer set search_path = public as $$
  select id, display_name, avatar_emoji from profiles
  where friend_code = upper(code) and display_name is not null;
$$;

-- Security-definer functions are executable by PUBLIC unless revoked.
revoke execute on function refresh_weekly_xp() from public, anon, authenticated;
revoke execute on function lookup_friend_code(text) from public, anon;
grant execute on function lookup_friend_code(text) to authenticated;
revoke execute on function generate_friend_code() from public, anon, authenticated;

-- Atomic hint-log append: last-write-wins on a whole-jsonb update loses a
-- concurrent tier. Returns the tiers now recorded for the seed.
create or replace function record_hint(
  p_session uuid, p_user uuid, p_seed text, p_tier int
) returns int[]
language plpgsql security definer set search_path = public as $$
declare
  tiers int[];
begin
  update sessions
    set hint_log = jsonb_set(
          hint_log, array[p_seed],
          coalesce(hint_log -> p_seed, '[]'::jsonb) || to_jsonb(p_tier), true),
        hints_used = hints_used + 1
    where id = p_session
      and user_id = p_user
      and status = 'in_progress'
      and not coalesce(hint_log -> p_seed, '[]'::jsonb) @> to_jsonb(p_tier)
    returning array(select jsonb_array_elements_text(hint_log -> p_seed)::int)
    into tiers;

  if tiers is null then
    select array(select jsonb_array_elements_text(hint_log -> p_seed)::int)
      into tiers from sessions where id = p_session and user_id = p_user;
  end if;
  return coalesce(tiers, '{}');
end;
$$;

revoke execute on function record_hint(uuid, uuid, text, int)
  from public, anon, authenticated;

-- Atomic per-attempt bookkeeping: increments in SQL so two slots submitted
-- at once cannot lose an update, and claims completion exactly once.
create or replace function apply_attempt(
  p_session uuid, p_user uuid, p_xp int, p_category category,
  p_rating int, p_correct boolean, p_median int, p_slots int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  claimed uuid;
  answered int;
begin
  update sessions set xp_earned = xp_earned + p_xp where id = p_session;

  update category_ratings
    set rating = p_rating,
        puzzles_seen = puzzles_seen + 1,
        correct_count = correct_count + (case when p_correct then 1 else 0 end),
        median_time_ms = p_median,
        updated_at = now()
    where user_id = p_user and category = p_category;

  select count(*) into answered from attempts where session_id = p_session;
  if answered < p_slots then
    return false;
  end if;

  -- Only one caller wins this update, so completion runs exactly once.
  update sessions set status = 'complete'
    where id = p_session and status = 'in_progress'
    returning id into claimed;
  return claimed is not null;
end;
$$;

revoke execute on function apply_attempt(
  uuid, uuid, int, category, int, boolean, int, int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security. Scoring writes (sessions, attempts, ratings, xp,
-- achievements) go through server routes with the service role, so clients
-- get no direct write path to anything a leaderboard depends on.
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table category_ratings enable row level security;
alter table sessions enable row level security;
alter table attempts enable row level security;
alter table achievements enable row level security;
alter table friendships enable row level security;
alter table challenges enable row level security;
alter table challenge_results enable row level security;
alter table hint_cache enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid() = id);
create policy "update own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Clients may edit identity and preference columns only; xp, streaks and
-- scores are server-written.
revoke insert, update, delete on profiles from anon, authenticated;
grant update (display_name, avatar_emoji, school, year_group, timezone,
              reminder_time, public_leaderboard)
  on profiles to authenticated;

create policy "read own ratings" on category_ratings
  for select using (auth.uid() = user_id);
revoke insert, update, delete on category_ratings from anon, authenticated;

create policy "read own sessions" on sessions
  for select using (auth.uid() = user_id);
revoke insert, update, delete on sessions from anon, authenticated;

create policy "read own attempts" on attempts
  for select using (auth.uid() = user_id);
revoke insert, update, delete on attempts from anon, authenticated;

create policy "read own achievements" on achievements
  for select using (auth.uid() = user_id);
revoke insert, update, delete on achievements from anon, authenticated;

create policy "read own friendships" on friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "request friendship" on friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');
create policy "accept friendship" on friendships
  for update using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id and status = 'accepted');
create policy "remove friendship" on friendships
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);
-- Accepting may only flip status; the pair itself is fixed at request time.
revoke update on friendships from anon, authenticated;
grant update (status) on friendships to authenticated;

-- Challenges are server-written only: the seeds they carry are fed to the
-- grader, so a client that could author them could mint its own answers.
revoke insert, update, delete on challenges from anon, authenticated;
revoke select on challenges from anon, authenticated;

create policy "read challenge results" on challenge_results
  for select using (true);
revoke insert, update, delete on challenge_results from anon, authenticated;

create policy "read hint cache" on hint_cache
  for select using (auth.role() = 'authenticated');
revoke insert, update, delete on hint_cache from anon, authenticated;

grant select on leaderboard_view to anon, authenticated;
-- The materialised view has no opt-out filter; only the wrapper is public.
revoke all on weekly_xp_mv from anon, authenticated;
grant select on weekly_leaderboard to anon, authenticated;
