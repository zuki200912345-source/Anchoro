import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FriendshipRow } from "@/lib/database.types";

// Friends list + add-by-code. Reads and the pending/accept/remove writes the
// client can do itself go through RLS; this route exists for the two things
// RLS cannot express: resolving a friend code to a user, and reading the
// display name of someone who is not on the public leaderboard.

export interface FriendRow {
  id: string; // the other user's id
  display_name: string;
  avatar_emoji: string | null;
  friendship_id: string;
  direction: "outgoing" | "incoming";
  status: "pending" | "accepted";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Your session has ended. Sign in again." },
      { status: 401 },
    );
  }

  // RLS returns only rows where the caller is requester or addressee.
  const { data: friendships, error } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "The friends list didn't load. Try again." },
      { status: 500 },
    );
  }

  const rows = (friendships ?? []) as FriendshipRow[];
  const otherIds = rows.map((f) =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id,
  );

  // Friends may have public_leaderboard off, so their names are not readable
  // under RLS. The caller is verified and we only fetch their counterparts.
  let names = new Map<string, { display_name: string | null; avatar_emoji: string | null }>();
  if (otherIds.length > 0) {
    const admin = createAdminClient();
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, display_name, avatar_emoji")
      .in("id", otherIds);
    if (profileError) {
      return NextResponse.json(
        { error: "The friends list didn't load. Try again." },
        { status: 500 },
      );
    }
    names = new Map(
      (profiles ?? []).map((p) => [
        p.id,
        { display_name: p.display_name, avatar_emoji: p.avatar_emoji },
      ]),
    );
  }

  const friends: FriendRow[] = rows.map((f) => {
    const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
    const profile = names.get(otherId);
    return {
      id: otherId,
      display_name: profile?.display_name ?? "Player",
      avatar_emoji: profile?.avatar_emoji ?? null,
      friendship_id: f.id,
      direction: f.requester_id === user.id ? "outgoing" : "incoming",
      status: f.status,
    };
  });

  return NextResponse.json({ friends });
}

const postSchema = z.object({ code: z.string().trim().min(1).max(12) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Your session has ended. Sign in again." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body wasn't valid JSON." },
      { status: 400 },
    );
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Type the 6-character code first." },
      { status: 400 },
    );
  }
  const code = parsed.data.code.toUpperCase();
  if (code.length !== 6) {
    return NextResponse.json(
      { error: "Codes are 6 characters. Check it and try again." },
      { status: 400 },
    );
  }

  const { data: matches, error: lookupError } = await supabase.rpc(
    "lookup_friend_code",
    { code },
  );
  if (lookupError) {
    return NextResponse.json(
      { error: "The code lookup didn't finish. Try again." },
      { status: 500 },
    );
  }
  const target = (matches ?? [])[0];
  if (!target) {
    return NextResponse.json(
      { error: "No player has that code. Check it with your friend." },
      { status: 404 },
    );
  }
  if (target.id === user.id) {
    return NextResponse.json({ error: "That's your own code." }, { status: 400 });
  }

  // A pair can already exist in either direction.
  const { data: existingRows } = await supabase
    .from("friendships")
    .select("id, requester_id, status")
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${target.id}),` +
        `and(requester_id.eq.${target.id},addressee_id.eq.${user.id})`,
    )
    .limit(1);
  const existing = existingRows?.[0];
  if (existing) {
    if (existing.status === "accepted") {
      return NextResponse.json(
        { error: "You're already friends." },
        { status: 409 },
      );
    }
    if (existing.requester_id === user.id) {
      return NextResponse.json(
        { error: "Request already sent." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "They asked first. Accept their request instead." },
      { status: 409 },
    );
  }

  // RLS: insert allowed only with requester = caller and status pending.
  const { data: inserted, error: insertError } = await supabase
    .from("friendships")
    .insert({
      requester_id: user.id,
      addressee_id: target.id,
      status: "pending",
    } as never)
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return NextResponse.json(
        { error: "Request already sent." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "The request didn't save. Try again." },
      { status: 500 },
    );
  }

  const friend: FriendRow = {
    id: target.id,
    display_name: target.display_name,
    avatar_emoji: target.avatar_emoji,
    friendship_id: (inserted as { id: string }).id,
    direction: "outgoing",
    status: "pending",
  };
  return NextResponse.json({ friend });
}
