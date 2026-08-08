-- Anchor — leaderboards rebuilt per RESEARCH-SPEC R3 / Stage 3.
-- Run after 20260805000000_research_spec.sql.
--
-- The research strategy rejects absolute top-score global boards: the
-- peer-reviewed weight is that they demotivate low and median performers
-- (Hanus & Fox 2015; a 2024 Learning & Instruction quasi-experiment found
-- leaderboards lowered exam scores). What it endorses instead is improvement
-- and independence boards — opt-in, skill-banded, over an ephemeral window.
--
-- This migration adds an explicit opt-in (distinct from the old
-- public_leaderboard, which defaulted true), and two views that rank only
-- opted-in, named users, only within a rolling 7-day window, and never by
-- speed. Both derive from the attempts table, so they work whether or not the
-- /api/learn independence pipeline has run.

-- Opt-in, not opt-out (Stage 3). A user is ranked only after choosing to be.
alter table profiles
  add column leaderboard_opt_in boolean not null default false;

-- A coarse ability band from the mean skill rating, so people are compared
-- with peers of similar starting ability rather than globally. Buckets 1..4.
create or replace function ability_band(p_user uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select greatest(1, least(4,
    width_bucket(coalesce(avg(rating), 1000), 700, 1600, 4)))
  from category_ratings where user_id = p_user;
$$;

revoke execute on function ability_band(uuid) from public, anon;
grant execute on function ability_band(uuid) to authenticated;

-- Independence board: unaided solve rate over the last 7 days. "Unaided" here
-- means the attempt used no hints. Needs a minimum sample so a single lucky
-- solve does not top the board.
create view independence_board as
  select
    p.id,
    p.display_name,
    p.avatar_emoji,
    ability_band(p.id) as band,
    count(*) filter (where a.hints_used = 0) as unaided_attempts,
    count(*) filter (where a.hints_used = 0 and a.correct) as unaided_correct,
    round(
      100.0 * count(*) filter (where a.hints_used = 0 and a.correct)
        / nullif(count(*) filter (where a.hints_used = 0), 0)
    )::int as independence_pct
  from profiles p
  join attempts a
    on a.user_id = p.id and a.created_at >= now() - interval '7 days'
  where p.leaderboard_opt_in = true and p.display_name is not null
  group by p.id, p.display_name, p.avatar_emoji
  having count(*) filter (where a.hints_used = 0) >= 5;

-- Most-improved board: change in unaided accuracy, this 7-day window versus
-- the previous one. Both windows need a sample or the delta is noise.
create view most_improved_board as
  with this_week as (
    select user_id,
      count(*) filter (where hints_used = 0) as ua,
      count(*) filter (where hints_used = 0 and correct) as uc
    from attempts where created_at >= now() - interval '7 days'
    group by user_id),
  prev_week as (
    select user_id,
      count(*) filter (where hints_used = 0) as ua,
      count(*) filter (where hints_used = 0 and correct) as uc
    from attempts
    where created_at >= now() - interval '14 days'
      and created_at < now() - interval '7 days'
    group by user_id)
  select
    p.id,
    p.display_name,
    p.avatar_emoji,
    ability_band(p.id) as band,
    round(
      (100.0 * tw.uc / nullif(tw.ua, 0))
      - (100.0 * pw.uc / nullif(pw.ua, 0))
    )::int as improvement_pct
  from profiles p
  join this_week tw on tw.user_id = p.id
  join prev_week pw on pw.user_id = p.id
  where p.leaderboard_opt_in = true and p.display_name is not null
    and tw.ua >= 5 and pw.ua >= 5;

-- Views cannot carry RLS, so their WHERE clauses do the gating: only opted-in,
-- named users appear, and only the same public-safe columns leaderboard_view
-- already exposes. No speed, no absolute score.
grant select on independence_board to authenticated;
grant select on most_improved_board to authenticated;

-- Clients may flip their own opt-in (identity/preference column, same posture
-- as the other editable profile columns in the first migration).
grant update (leaderboard_opt_in) on profiles to authenticated;
