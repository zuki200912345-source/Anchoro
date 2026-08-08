import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Friends leaderboard data. Accepted friends see each other's numbers even
// when a profile is off the public boards (§9), which RLS cannot express, so
// this route verifies the caller and their friendships, then reads the
// friend profiles with the service role. No input to validate: the only
// parameter is the caller's identity, taken from the session.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to see friends." },
      { status: 401 },
    );
  }

  const admin = createAdminClient();

  const { data: friendships, error: friendshipError } = await admin
    .from("friendships")
    .select("requester_id, addressee_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
  if (friendshipError) {
    return NextResponse.json(
      { error: "Friends didn't load. Refresh to retry." },
      { status: 500 },
    );
  }

  // The caller ranks among their friends, so their own row rides along.
  const ids = new Set<string>([user.id]);
  for (const f of friendships ?? []) {
    ids.add(f.requester_id === user.id ? f.addressee_id : f.requester_id);
  }

  const idList = [...ids];
  const { data: rows, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, avatar_emoji, streak_current")
    .in("id", idList)
    .not("display_name", "is", null)
    .order("id", { ascending: true });
  if (profileError) {
    return NextResponse.json(
      { error: "Friends didn't load. Refresh to retry." },
      { status: 500 },
    );
  }

  // Rank friends by independence over the last 7 days, not an absolute score
  // (RESEARCH-SPEC R3). Independence = unaided solve rate.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: attempts } = await admin
    .from("attempts")
    .select("user_id, correct, hints_used")
    .in("user_id", idList)
    .gte("created_at", since);

  const tally = new Map<string, { unaided: number; correct: number }>();
  for (const a of attempts ?? []) {
    if (a.hints_used > 0) continue;
    const t = tally.get(a.user_id) ?? { unaided: 0, correct: 0 };
    t.unaided += 1;
    if (a.correct) t.correct += 1;
    tally.set(a.user_id, t);
  }

  const enriched = (rows ?? []).map((r) => {
    const t = tally.get(r.id);
    const independence_pct =
      t && t.unaided >= 3 ? Math.round((t.correct / t.unaided) * 100) : null;
    return {
      id: r.id,
      display_name: r.display_name,
      avatar_emoji: r.avatar_emoji,
      independence_pct,
    };
  });

  return NextResponse.json({ rows: enriched });
}
