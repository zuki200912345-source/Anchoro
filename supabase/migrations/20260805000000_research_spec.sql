-- Anchor — research-backed product strategy.
-- Implements RESEARCH-SPEC.md. Run after 20260804000000_init.sql.
--
-- The headline changes: an attempt is now the gate for help (Feature B), the
-- single composite score is retired in favour of a transparent profile
-- (Feature F / R1), XP rewards independence rather than completion (R4), and
-- every claim the app makes is instrumented so it can be tested (§12, §13).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type item_kind as enum (
  'retrieval',      -- curriculum recall (Feature A)
  'reasoning',      -- multi-step curricular reasoning
  'transfer',       -- novel context, same strategy (N6)
  'practice'        -- the four procedural puzzle types, kept as practice only
);

create type help_level as enum (
  'none',           -- unaided
  'strategy',       -- generic strategy prompt (the ungrounded fallback, B8)
  'question',       -- Socratic question, reveals nothing (C1)
  'narrow',         -- narrows the search space
  'next_step',      -- one concrete next move
  'solution'        -- full worked solution, only after sufficient effort (B4)
);

create type attempt_outcome as enum (
  'correct', 'incorrect', 'partial', 'skipped', 'low_effort'
);

create type experiment_arm as enum (
  'control', 'treatment', 'arm_a', 'arm_b', 'arm_c'
);

create type session_mode as enum (
  'assisted',       -- normal, AI available under the fading level
  'brain_only',     -- no AI during the session by design (E1)
  'review',         -- spaced retrieval re-test (N8)
  'transfer'        -- transfer challenge set (N6)
);

-- ---------------------------------------------------------------------------
-- Item bank. Curriculum-embedded, with a VERIFIED answer key — the primary
-- anti-hallucination technique (I3). AI may generate variants and distractors
-- but never adjudicates correctness (A4, I6).
-- ---------------------------------------------------------------------------

create table items (
  id uuid primary key default gen_random_uuid(),
  kind item_kind not null,
  subject text not null,              -- 'maths', 'physics', 'english', ...
  topic text not null,                -- 'linear equations', 'photosynthesis'
  skill text not null,                -- fine-grained skill tag, for banding
  year_group text,                    -- curriculum level this item targets
  difficulty integer not null check (difficulty between 1 and 10),

  stem text not null,                 -- the question as shown
  answer_key jsonb not null,          -- verified solution; never sent to client
  rubric jsonb,                       -- structured marking scheme (I2)
  worked_solution text,               -- released only after sufficient effort
  distractors jsonb,                  -- for multiple-choice variants
  common_misconceptions jsonb,        -- tag -> description, used by tutor (C3)

  -- Provenance: who verified this key. AI-generated items stay unverified
  -- until a human or a deterministic generator signs off.
  source text not null default 'authored',   -- 'authored' | 'generated' | 'procedural'
  verified boolean not null default false,
  variant_of uuid references items (id) on delete set null,

  created_at timestamptz not null default now()
);

create index items_pick on items (kind, skill, difficulty) where verified;
create index items_subject_topic on items (subject, topic);
create index items_variant on items (variant_of);

-- ---------------------------------------------------------------------------
-- Attempt-first engine (Feature B). One row per (user, item) encounter; the
-- ordered chain of what they did lives in attempt_steps.
-- ---------------------------------------------------------------------------

create table item_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  item_id uuid not null references items (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  mode session_mode not null default 'assisted',

  -- Calibration (Feature H): confidence is captured BEFORE submitting.
  confidence_before integer check (confidence_before between 0 and 100),
  confidence_after integer check (confidence_after between 0 and 100),

  outcome attempt_outcome,
  -- Unaided means solved at help_level 'none' — the primary outcome (M1).
  unaided boolean not null default false,
  attempts_count integer not null default 0,
  max_help_level help_level not null default 'none',
  solution_revealed boolean not null default false,
  self_corrected boolean not null default false,      -- +5 XP (Kapur)
  persisted_after_error boolean not null default false, -- +5 XP (Liu et al.)

  -- Timing. think_ms is time to FIRST help request or first submit — the
  -- "time-thinking-before-help" measure (B5).
  think_ms integer,
  total_ms integer,

  self_explanation text,              -- N9 / +5 XP (Bisra 2018)
  self_explanation_score integer check (self_explanation_score between 0 and 100),
  misconception_tag text,             -- named by the tutor (C3)
  xp_awarded integer not null default 0,
  support_level_at_time integer,      -- fading level when this was served (D6)

  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index item_attempts_user on item_attempts (user_id, started_at desc);
create index item_attempts_user_item on item_attempts (user_id, item_id);
create index item_attempts_unaided on item_attempts (user_id, unaided, completed_at);

-- The attempt chain (B2): every submission and every hint, in order.
create table attempt_steps (
  id uuid primary key default gen_random_uuid(),
  item_attempt_id uuid not null references item_attempts (id) on delete cascade,
  step_index integer not null,
  kind text not null,                 -- 'attempt' | 'hint' | 'stuck' | 'explain_back'
  help_level help_level,              -- set when kind = 'hint'
  student_input jsonb,                -- what they submitted
  ai_output text,                     -- hint text / diagnosis shown
  grounded boolean,                   -- false => fell back to strategy prompt (B8)
  confidence integer check (confidence between 0 and 100),
  outcome attempt_outcome,
  elapsed_ms integer,
  created_at timestamptz not null default now(),
  unique (item_attempt_id, step_index)
);

create index attempt_steps_attempt on attempt_steps (item_attempt_id, step_index);

-- ---------------------------------------------------------------------------
-- Socratic tutor transcript (Feature C7).
-- ---------------------------------------------------------------------------

create table tutor_turns (
  id uuid primary key default gen_random_uuid(),
  item_attempt_id uuid not null references item_attempts (id) on delete cascade,
  turn_index integer not null,
  role text not null check (role in ('student', 'tutor')),
  content text not null,
  misconception_tag text,
  -- Confidence gating (I4): a refusal is recorded, not hidden.
  refused boolean not null default false,
  refusal_reason text,
  grounded boolean not null default true,
  created_at timestamptz not null default now(),
  unique (item_attempt_id, turn_index)
);

-- ---------------------------------------------------------------------------
-- Spaced retrieval scheduler (N8, A3). Expanding intervals; the 1–7 day window
-- is where Adesope et al. found the largest testing effects.
-- ---------------------------------------------------------------------------

create table reviews (
  user_id uuid not null references profiles (id) on delete cascade,
  item_id uuid not null references items (id) on delete cascade,
  due_on date not null,
  interval_days integer not null default 1,
  ease real not null default 2.5,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  last_reviewed_at timestamptz,
  -- Retention measured at the delayed re-test, not the immediate one (A5).
  last_delayed_correct boolean,
  primary key (user_id, item_id)
);

create index reviews_due on reviews (user_id, due_on);

-- ---------------------------------------------------------------------------
-- Error journal (N4). The student writes WHY the error happened; the entry is
-- resurfaced later and recurrence is measured.
-- ---------------------------------------------------------------------------

create table error_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  item_attempt_id uuid references item_attempts (id) on delete set null,
  item_id uuid references items (id) on delete set null,
  misconception_tag text,
  what_went_wrong text not null,      -- student's own words
  what_to_do_next text,
  revisited_at timestamptz,
  recurred boolean not null default false,
  created_at timestamptz not null default now()
);

create index error_journal_user on error_journal (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Brain-Only mode (Feature E). No AI during the session by design.
-- ---------------------------------------------------------------------------

create table brain_only_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  scheduled_for date not null,
  started_at timestamptz,
  completed_at timestamptz,
  items_total integer not null default 0,
  items_correct integer not null default 0,
  self_checked boolean not null default false,   -- E2
  created_at timestamptz not null default now()
);

create index brain_only_user on brain_only_sessions (user_id, scheduled_for desc);

-- ---------------------------------------------------------------------------
-- Independence profile (Feature F). Stored as separate dimensions with sample
-- counts so the UI can show uncertainty (F3). Never collapsed to one number.
-- ---------------------------------------------------------------------------

create table independence_daily (
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,

  -- Primary outcomes (M1)
  unaided_attempts integer not null default 0,
  unaided_correct integer not null default 0,
  delayed_retention_due integer not null default 0,
  delayed_retention_correct integer not null default 0,
  transfer_attempts integer not null default 0,
  transfer_correct integer not null default 0,

  -- Secondary (M2)
  total_attempts integer not null default 0,
  hints_requested integer not null default 0,
  solutions_revealed integer not null default 0,
  skipped integer not null default 0,
  median_think_ms integer,
  calibration_error real,             -- mean |confidence - correctness|
  self_explanations integer not null default 0,

  -- Dependence signal (M4): assisted accuracy minus unaided accuracy
  assisted_correct integer not null default 0,
  assisted_attempts integer not null default 0,

  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Experiment assignment (§13). Arms are sticky per user per experiment.
-- ---------------------------------------------------------------------------

create table experiment_assignments (
  user_id uuid not null references profiles (id) on delete cascade,
  experiment text not null,           -- 'attempt_first' | 'tutor_style' | ...
  arm experiment_arm not null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, experiment)
);

-- ---------------------------------------------------------------------------
-- Profile changes
-- ---------------------------------------------------------------------------

alter table profiles
  -- Feature D: 1 = strongest support, 5 = no AI.
  add column support_level integer not null default 2
    check (support_level between 1 and 5),
  add column support_level_updated_at timestamptz,
  -- N2: consecutive AI-free sessions. Distinct from the daily usage streak,
  -- which R4 says must not be rewarded.
  add column ai_free_streak integer not null default 0,
  add column ai_free_longest integer not null default 0,
  -- A7: streaks count retrieval ATTEMPTS, not correctness.
  add column retrieval_streak integer not null default 0;

comment on column profiles.cognitive_score is
  'DEPRECATED (RESEARCH-SPEC R1). A single composite score is scientifically '
  'indefensible; use the independence_daily dimensions instead. Retained only '
  'so existing rows do not break; no new code should read it.';

-- ---------------------------------------------------------------------------
-- RLS. Same posture as the first migration: users read their own rows, and
-- everything that scoring depends on is written by the service role only.
-- ---------------------------------------------------------------------------

alter table items enable row level security;
alter table item_attempts enable row level security;
alter table attempt_steps enable row level security;
alter table tutor_turns enable row level security;
alter table reviews enable row level security;
alter table error_journal enable row level security;
alter table brain_only_sessions enable row level security;
alter table independence_daily enable row level security;
alter table experiment_assignments enable row level security;

-- Items are readable, but answer_key / worked_solution must never reach a
-- client. Reads go through items_public, which omits them.
create view items_public as
  select id, kind, subject, topic, skill, year_group, difficulty, stem,
         distractors, variant_of
  from items
  where verified;

revoke select on items from anon, authenticated;
grant select on items_public to authenticated;

create policy "read own item attempts" on item_attempts
  for select using (auth.uid() = user_id);
revoke insert, update, delete on item_attempts from anon, authenticated;

create policy "read own steps" on attempt_steps
  for select using (exists (
    select 1 from item_attempts a
    where a.id = attempt_steps.item_attempt_id and a.user_id = auth.uid()));
revoke insert, update, delete on attempt_steps from anon, authenticated;

create policy "read own tutor turns" on tutor_turns
  for select using (exists (
    select 1 from item_attempts a
    where a.id = tutor_turns.item_attempt_id and a.user_id = auth.uid()));
revoke insert, update, delete on tutor_turns from anon, authenticated;

create policy "read own reviews" on reviews
  for select using (auth.uid() = user_id);
revoke insert, update, delete on reviews from anon, authenticated;

-- The journal is the one place the student writes freely, so they may insert
-- and edit their own entries.
create policy "read own journal" on error_journal
  for select using (auth.uid() = user_id);
create policy "write own journal" on error_journal
  for insert with check (auth.uid() = user_id);
create policy "update own journal" on error_journal
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke update, delete on error_journal from anon, authenticated;
grant update (what_went_wrong, what_to_do_next) on error_journal to authenticated;

create policy "read own brain only" on brain_only_sessions
  for select using (auth.uid() = user_id);
revoke insert, update, delete on brain_only_sessions from anon, authenticated;

create policy "read own independence" on independence_daily
  for select using (auth.uid() = user_id);
revoke insert, update, delete on independence_daily from anon, authenticated;

create policy "read own arm" on experiment_assignments
  for select using (auth.uid() = user_id);
revoke insert, update, delete on experiment_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic helpers (service-role only), mirroring the first migration's pattern.
-- ---------------------------------------------------------------------------

-- Records one step of the attempt chain and keeps the parent counters honest.
create or replace function record_attempt_step(
  p_attempt uuid, p_kind text, p_help help_level, p_input jsonb,
  p_ai text, p_grounded boolean, p_confidence integer,
  p_outcome attempt_outcome, p_elapsed integer
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  next_index integer;
begin
  select coalesce(max(step_index), -1) + 1 into next_index
    from attempt_steps where item_attempt_id = p_attempt;

  insert into attempt_steps (
    item_attempt_id, step_index, kind, help_level, student_input, ai_output,
    grounded, confidence, outcome, elapsed_ms)
  values (
    p_attempt, next_index, p_kind, p_help, p_input, p_ai,
    p_grounded, p_confidence, p_outcome, p_elapsed);

  if p_kind = 'attempt' then
    update item_attempts set attempts_count = attempts_count + 1
      where id = p_attempt;
  end if;

  if p_kind = 'hint' and p_help is not null then
    update item_attempts
      set max_help_level = greatest(max_help_level, p_help),
          solution_revealed = solution_revealed or (p_help = 'solution')
      where id = p_attempt;
  end if;

  return next_index;
end;
$$;

revoke execute on function record_attempt_step(
  uuid, text, help_level, jsonb, text, boolean, integer, attempt_outcome, integer)
  from public, anon, authenticated;

-- SM-2-style expanding interval scheduler (N8). Correct answers push the next
-- review out; lapses pull it back to one day.
create or replace function schedule_review(
  p_user uuid, p_item uuid, p_correct boolean
) returns date
language plpgsql security definer set search_path = public as $$
declare
  r reviews%rowtype;
  new_interval integer;
  new_ease real;
begin
  select * into r from reviews where user_id = p_user and item_id = p_item;

  if not found then
    insert into reviews (user_id, item_id, due_on, interval_days, repetitions,
                         last_reviewed_at, last_delayed_correct)
      values (p_user, p_item, current_date + 1, 1, 1, now(), p_correct);
    return current_date + 1;
  end if;

  if p_correct then
    new_ease := least(3.0, r.ease + 0.1);
    new_interval := case r.repetitions
      when 0 then 1
      when 1 then 3
      else greatest(1, round(r.interval_days * new_ease)::int)
    end;
    update reviews set
      interval_days = new_interval,
      ease = new_ease,
      repetitions = r.repetitions + 1,
      due_on = current_date + new_interval,
      last_reviewed_at = now(),
      last_delayed_correct = true
      where user_id = p_user and item_id = p_item;
    return current_date + new_interval;
  else
    new_ease := greatest(1.3, r.ease - 0.2);
    update reviews set
      interval_days = 1,
      ease = new_ease,
      repetitions = 0,
      lapses = r.lapses + 1,
      due_on = current_date + 1,
      last_reviewed_at = now(),
      last_delayed_correct = false
      where user_id = p_user and item_id = p_item;
    return current_date + 1;
  end if;
end;
$$;

revoke execute on function schedule_review(uuid, uuid, boolean)
  from public, anon, authenticated;

-- Rolls one finished item attempt into the daily independence counters (§12).
create or replace function roll_independence(p_attempt uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a item_attempts%rowtype;
  k item_kind;
  is_correct boolean;
begin
  select * into a from item_attempts where id = p_attempt;
  if not found or a.completed_at is null then return; end if;
  select kind into k from items where id = a.item_id;
  is_correct := (a.outcome = 'correct');

  insert into independence_daily (user_id, day) values (a.user_id, current_date)
    on conflict (user_id, day) do nothing;

  update independence_daily set
    total_attempts = total_attempts + 1,
    unaided_attempts = unaided_attempts + (case when a.unaided then 1 else 0 end),
    unaided_correct = unaided_correct
      + (case when a.unaided and is_correct then 1 else 0 end),
    assisted_attempts = assisted_attempts + (case when a.unaided then 0 else 1 end),
    assisted_correct = assisted_correct
      + (case when not a.unaided and is_correct then 1 else 0 end),
    transfer_attempts = transfer_attempts + (case when k = 'transfer' then 1 else 0 end),
    transfer_correct = transfer_correct
      + (case when k = 'transfer' and is_correct then 1 else 0 end),
    hints_requested = hints_requested
      + (case when a.max_help_level <> 'none' then 1 else 0 end),
    solutions_revealed = solutions_revealed + (case when a.solution_revealed then 1 else 0 end),
    skipped = skipped + (case when a.outcome = 'skipped' then 1 else 0 end),
    self_explanations = self_explanations
      + (case when a.self_explanation is not null then 1 else 0 end)
    where user_id = a.user_id and day = current_date;
end;
$$;

revoke execute on function roll_independence(uuid) from public, anon, authenticated;
