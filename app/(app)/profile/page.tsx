import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { IdentityCard } from "./identity-card";
import { FriendCodeCard } from "./friend-code-card";
import { FriendsCard } from "./friends-card";
import { SettingsCard } from "./settings-card";
import { ChallengeCta } from "@/components/share/challenge-cta";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, avatar_emoji, school, year_group, friend_code, timezone, reminder_time, public_leaderboard, leaderboard_opt_in, xp, level, streak_current, streak_longest, created_at",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return (
      <section className="plane p-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          Profile didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-slate">
          The profile row didn&apos;t come back. Refresh, or sign in again.
        </p>
      </section>
    );
  }

  const memberSince = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(profile.created_at));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const shareUrl = `${siteUrl}/auth?mode=signup&ref=${profile.friend_code}`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Profile</h1>

      <IdentityCard
        userId={user.id}
        displayName={profile.display_name ?? "Player"}
        avatarEmoji={profile.avatar_emoji}
        school={profile.school}
        yearGroup={profile.year_group}
        level={profile.level}
        xp={profile.xp}
        streakCurrent={profile.streak_current}
        streakLongest={profile.streak_longest}
        memberSince={memberSince}
      />

      <FriendCodeCard code={profile.friend_code} shareUrl={shareUrl} />

      <ChallengeCta friendCode={profile.friend_code} />

      <FriendsCard />

      <SettingsCard
        userId={user.id}
        leaderboardOptIn={profile.leaderboard_opt_in ?? false}
        reminderTime={profile.reminder_time?.slice(0, 5) ?? null}
        timezone={profile.timezone}
      />

      <form action={signOutAction} className="self-start">
        <Button type="submit" variant="secondary" className="min-h-11">
          Sign out
        </Button>
      </form>
    </div>
  );
}
