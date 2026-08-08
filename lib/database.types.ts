// Database types matching supabase/migrations/20260804000000_init.sql.
// Hand-written because the schema was authored before a live project existed.
// After running the migration you can regenerate with:
//   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts

import type { Category, SessionStatus, SessionType } from "./types";

export type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_emoji: string | null;
  school: string | null;
  year_group: string | null;
  friend_code: string;
  timezone: string;
  reminder_time: string | null;
  public_leaderboard: boolean;
  // Added by 20260805000100_leaderboards.sql — opt-in, not opt-out (R3).
  leaderboard_opt_in: boolean;
  // Added by 20260805000000_research_spec.sql.
  support_level: number;
  support_level_updated_at: string | null;
  ai_free_streak: number;
  ai_free_longest: number;
  retrieval_streak: number;
  xp: number;
  level: number;
  streak_current: number;
  streak_longest: number;
  streak_freezes: number;
  last_session_date: string | null;
  cognitive_score: number;
  referred_by: string | null;
  created_at: string;
}

export type CategoryRatingRow = {
  user_id: string;
  category: Category;
  rating: number;
  puzzles_seen: number;
  correct_count: number;
  median_time_ms: number | null;
  updated_at: string;
}

export type SessionRow = {
  id: string;
  user_id: string;
  type: SessionType;
  date: string;
  puzzle_seeds: unknown;
  status: SessionStatus;
  score: number | null;
  xp_earned: number;
  accuracy: number | null;
  hints_used: number;
  hint_log: Record<string, number[]>;
  cognitive_score_after: number | null;
  feedback: string | null;
  challenge_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export type AttemptRow = {
  id: string;
  session_id: string;
  user_id: string;
  puzzle_type: string;
  category: Category;
  difficulty: number;
  seed: string;
  correct: boolean;
  time_ms: number;
  hints_used: number;
  attempts: number;
  answer: unknown;
  rating_delta: number;
  created_at: string;
}

export type AchievementRow = {
  id: string;
  user_id: string;
  achievement_key: string;
  unlocked_at: string;
}

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: string;
}

export type ChallengeRow = {
  id: string;
  code: string;
  creator_id: string;
  category: Category;
  difficulty: number;
  puzzle_seeds: unknown;
  expires_at: string;
  created_at: string;
}

export type ChallengeResultRow = {
  id: string;
  challenge_id: string;
  user_id: string;
  score: number;
  time_ms: number;
  completed_at: string;
}

export type HintCacheRow = {
  id: string;
  puzzle_type: string;
  seed: string;
  tier: number;
  hint_text: string;
  created_at: string;
}

export type LeaderboardViewRow = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
  school: string | null;
  xp: number;
  cognitive_score: number;
  streak_current: number;
}

export type WeeklyXpRow = {
  user_id: string;
  xp: number;
}

export type IndependenceBoardRow = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
  band: number;
  unaided_attempts: number;
  unaided_correct: number;
  independence_pct: number;
}

export type MostImprovedBoardRow = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
  band: number;
  improvement_pct: number;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string; friend_code: string };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      category_ratings: {
        Row: CategoryRatingRow;
        Insert: Partial<CategoryRatingRow> & {
          user_id: string;
          category: Category;
        };
        Update: Partial<CategoryRatingRow>;
        Relationships: [];
      };
      sessions: {
        Row: SessionRow;
        Insert: Partial<SessionRow> & {
          user_id: string;
          type: SessionType;
          date: string;
          puzzle_seeds: unknown;
        };
        Update: Partial<SessionRow>;
        Relationships: [];
      };
      attempts: {
        Row: AttemptRow;
        Insert: Partial<AttemptRow> & {
          session_id: string;
          user_id: string;
          puzzle_type: string;
          category: Category;
          difficulty: number;
          seed: string;
          correct: boolean;
          time_ms: number;
        };
        Update: Partial<AttemptRow>;
        Relationships: [];
      };
      achievements: {
        Row: AchievementRow;
        Insert: Partial<AchievementRow> & {
          user_id: string;
          achievement_key: string;
        };
        Update: Partial<AchievementRow>;
        Relationships: [];
      };
      friendships: {
        Row: FriendshipRow;
        Insert: Partial<FriendshipRow> & {
          requester_id: string;
          addressee_id: string;
        };
        Update: Partial<FriendshipRow>;
        Relationships: [];
      };
      challenges: {
        Row: ChallengeRow;
        Insert: Partial<ChallengeRow> & {
          code: string;
          creator_id: string;
          category: Category;
          difficulty: number;
          puzzle_seeds: unknown;
        };
        Update: Partial<ChallengeRow>;
        Relationships: [];
      };
      challenge_results: {
        Row: ChallengeResultRow;
        Insert: Partial<ChallengeResultRow> & {
          challenge_id: string;
          user_id: string;
          score: number;
          time_ms: number;
        };
        Update: Partial<ChallengeResultRow>;
        Relationships: [];
      };
      hint_cache: {
        Row: HintCacheRow;
        Insert: Partial<HintCacheRow> & {
          puzzle_type: string;
          seed: string;
          tier: number;
          hint_text: string;
        };
        Update: Partial<HintCacheRow>;
        Relationships: [];
      };
    };
    Views: {
      leaderboard_view: { Row: LeaderboardViewRow; Relationships: [] };
      weekly_leaderboard: { Row: WeeklyXpRow; Relationships: [] };
      weekly_xp_mv: { Row: WeeklyXpRow; Relationships: [] };
      independence_board: { Row: IndependenceBoardRow; Relationships: [] };
      most_improved_board: { Row: MostImprovedBoardRow; Relationships: [] };
    };
    Functions: {
      refresh_weekly_xp: { Args: Record<string, never>; Returns: undefined };
      lookup_friend_code: {
        Args: { code: string };
        Returns: {
          id: string;
          display_name: string;
          avatar_emoji: string | null;
        }[];
      };
      record_hint: {
        Args: {
          p_session: string;
          p_user: string;
          p_seed: string;
          p_tier: number;
        };
        Returns: number[];
      };
      apply_attempt: {
        Args: {
          p_session: string;
          p_user: string;
          p_xp: number;
          p_category: Category;
          p_rating: number;
          p_correct: boolean;
          p_median: number;
          p_slots: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      category: Category;
      session_type: SessionType;
      session_status: SessionStatus;
      friendship_status: "pending" | "accepted";
    };
    CompositeTypes: Record<string, never>;
  };
}
