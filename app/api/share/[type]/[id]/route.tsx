// Share cards, 1080x1080, drawn server-side with next/og. Palette hexes are
// inlined because satori has no CSS variables. Text renders in the og default
// face (Noto Sans): pulling Google fonts into satori at request time is flaky,
// so the cards trade the app's type stack for reliability.

import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACHIEVEMENTS } from "@/lib/achievements";

const PAPER = "#e4e7dc";
const INK = "#16190f";
const SLATE = "#5d6852";
const FLAG = "#e01b54";
const GOLD = "#f0b429";
const CHALK = "#f7f8f4";
const GRID = "rgba(22,25,15,0.08)";

const SIZE = 1080;

const paramsSchema = z.object({
  type: z.enum(["score", "streak", "achievement"]),
  id: z.string().uuid(),
});

const notFound = () =>
  NextResponse.json(
    { error: "No share card at that address. Check the link." },
    { status: 404 },
  );

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function OgWordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", gap: 7 }}>
          <div style={{ width: 30, height: 30, borderRadius: 4, backgroundColor: INK }} />
          <div style={{ width: 30, height: 30, borderRadius: 4, backgroundColor: FLAG }} />
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <div style={{ width: 30, height: 30, borderRadius: 4, backgroundColor: INK }} />
          <div style={{ width: 30, height: 30, borderRadius: 4, backgroundColor: INK }} />
        </div>
      </div>
      <div style={{ fontSize: 64, fontWeight: 700, color: INK, letterSpacing: -2 }}>
        anchor
      </div>
    </div>
  );
}

function card(children: React.ReactNode) {
  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 88,
          backgroundColor: PAPER,
          backgroundImage: `linear-gradient(to right, ${GRID} 2px, transparent 2px), linear-gradient(to bottom, ${GRID} 2px, transparent 2px)`,
          backgroundSize: "40px 40px",
          color: INK,
        }}
      >
        <OgWordmark />
        {children}
        <div style={{ display: "flex", fontSize: 34, color: SLATE }}>
          Five puzzles a day. No help for the first 45 seconds.
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { "cache-control": "public, max-age=3600" },
    },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return notFound();
  const { type, id } = parsed.data;
  const admin = createAdminClient();

  if (type === "score") {
    const { data: session } = await admin
      .from("sessions")
      .select("user_id, score, accuracy, date, status")
      .eq("id", id)
      .maybeSingle();
    if (!session || session.status !== "complete") return notFound();

    const { data: owner } = await admin
      .from("profiles")
      .select("display_name, public_leaderboard")
      .eq("id", session.user_id)
      .maybeSingle();
    // Opted-out profiles do not get public cards; nothing leaks.
    if (!owner?.public_leaderboard) return notFound();

    const solved = Math.round((session.accuracy ?? 0) * 5);
    return card(
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 40, color: SLATE }}>
          {owner.display_name ?? "An anchor player"} · {fmtDate(session.date)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 28,
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: 340, fontWeight: 700, lineHeight: 1 }}>
            {session.score ?? 0}
          </div>
          <div style={{ fontSize: 52, color: SLATE }}>score</div>
        </div>
        <div style={{ display: "flex", fontSize: 52, marginTop: 12 }}>
          {solved}/5 solved
        </div>
      </div>,
    );
  }

  if (type === "streak") {
    const { data: owner } = await admin
      .from("profiles")
      .select("display_name, streak_current, public_leaderboard")
      .eq("id", id)
      .maybeSingle();
    if (!owner?.public_leaderboard) return notFound();

    const streak = owner.streak_current;
    const filled = Math.min(16, streak);
    return card(
      <div style={{ display: "flex", alignItems: "center", gap: 72 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 40, color: SLATE }}>
            {owner.display_name ?? "An anchor player"}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 300,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {streak}
          </div>
          <div style={{ display: "flex", fontSize: 52 }}>
            day{streak === 1 ? "" : "s"} straight
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[0, 1, 2, 3].map((row) => (
            <div key={row} style={{ display: "flex", gap: 14 }}>
              {[0, 1, 2, 3].map((col) => {
                const on = row * 4 + col < filled;
                return (
                  <div
                    key={col}
                    style={{
                      width: 84,
                      height: 84,
                      borderRadius: 6,
                      backgroundColor: on ? FLAG : CHALK,
                      border: `3px solid ${on ? FLAG : SLATE}`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>,
    );
  }

  // Achievement.
  const { data: row } = await admin
    .from("achievements")
    .select("user_id, achievement_key, unlocked_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return notFound();

  const { data: owner } = await admin
    .from("profiles")
    .select("display_name, public_leaderboard")
    .eq("id", row.user_id)
    .maybeSingle();
  if (!owner?.public_leaderboard) return notFound();

  const def = ACHIEVEMENTS.find((a) => a.key === row.achievement_key);
  const name = def?.name ?? row.achievement_key.replace(/[-_]+/g, " ");
  return card(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          width: 170,
          height: 170,
          borderRadius: 12,
          backgroundColor: GOLD,
          border: `4px solid ${INK}`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 1.05,
          marginTop: 44,
        }}
      >
        {name}
      </div>
      {def?.description && (
        <div style={{ display: "flex", fontSize: 44, color: SLATE, marginTop: 18 }}>
          {def.description}
        </div>
      )}
      <div style={{ display: "flex", fontSize: 40, color: SLATE, marginTop: 28 }}>
        {owner.display_name ?? "An anchor player"} ·{" "}
        {fmtDate(row.unlocked_at.slice(0, 10))}
      </div>
    </div>,
  );
}
