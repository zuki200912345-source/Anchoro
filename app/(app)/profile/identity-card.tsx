"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfileRow } from "@/lib/database.types";

// Same 24 faces as onboarding, so a re-pick feels familiar.
const AVATARS = [
  "🦊", "🐸", "🦉", "🐙", "🦖", "🐝",
  "🐢", "🦈", "🐇", "🦫", "🐊", "🦩",
  "🐞", "🐐", "🦭", "🐌", "🦅", "🐺",
  "🦋", "🐧", "🐘", "🦔", "🐆", "🐋",
];

const YEAR_GROUPS = [
  "Year 9",
  "Year 10",
  "Year 11",
  "Year 12",
  "Year 13",
  "Uni",
  "Other",
] as const;

export interface IdentityCardProps {
  userId: string;
  displayName: string;
  avatarEmoji: string | null;
  school: string | null;
  yearGroup: string | null;
  level: number;
  xp: number;
  streakCurrent: number;
  streakLongest: number;
  memberSince: string; // preformatted date string
}

export function IdentityCard(props: IdentityCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Shown values, updated optimistically on save.
  const [current, setCurrent] = useState({
    displayName: props.displayName,
    avatarEmoji: props.avatarEmoji,
    school: props.school,
    yearGroup: props.yearGroup,
  });

  // Draft values while editing.
  const [name, setName] = useState(current.displayName);
  const [emoji, setEmoji] = useState<string | null>(current.avatarEmoji);
  const [school, setSchool] = useState(current.school ?? "");
  const [yearGroup, setYearGroup] = useState(current.yearGroup ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // School autocomplete against schools other players already entered.
  useEffect(() => {
    const q = school.trim();
    if (!editing || q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/schools?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { schools?: string[] };
        setSuggestions(body.schools ?? []);
      } catch {
        // No suggestions; free text still works.
      }
    }, 200);
    return () => clearTimeout(t);
  }, [school, editing]);

  function startEditing() {
    setName(current.displayName);
    setEmoji(current.avatarEmoji);
    setSchool(current.school ?? "");
    setYearGroup(current.yearGroup ?? "");
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save() {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("A display name can't be empty. Type one first.");
      return;
    }
    setBusy(true);
    setError(null);

    const patch: Partial<ProfileRow> = {
      display_name: trimmedName,
      avatar_emoji: emoji,
      school: school.trim() || null,
      year_group: yearGroup || null,
    };
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", props.userId);
    setBusy(false);

    if (updateError) {
      setError("The profile didn't save. Try again.");
      return;
    }
    setCurrent({
      displayName: trimmedName,
      avatarEmoji: emoji,
      school: school.trim() || null,
      yearGroup: yearGroup || null,
    });
    setEditing(false);
    setSaved(true);
    router.refresh(); // nav shows the new name and face
  }

  return (
    <section className="plane p-5" aria-label="Identity">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-(--radius-ctl) border border-slate/40 bg-paper text-3xl"
          >
            {current.avatarEmoji ?? current.displayName.slice(0, 1)}
          </span>
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-tight">
              {current.displayName}
            </h2>
            <p className="text-sm text-slate">
              {[current.school, current.yearGroup].filter(Boolean).join(" · ") ||
                "No school set"}
            </p>
          </div>
        </div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={startEditing}
          >
            Edit profile
          </Button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {saved ? "Profile saved" : ""}
      </p>
      {saved && !editing && (
        <p className="mt-2 text-sm text-slate">Saved</p>
      )}

      {editing && (
        <div className="mt-4 grid gap-4 border-t border-slate/30 pt-4">
          <label className="grid gap-1.5 text-sm font-semibold">
            Display name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-semibold">
              Face <span className="font-normal text-slate">(optional)</span>
            </legend>
            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {AVATARS.map((face) => (
                <button
                  key={face}
                  type="button"
                  aria-pressed={emoji === face}
                  aria-label={`avatar ${face}`}
                  onClick={() => setEmoji(emoji === face ? null : face)}
                  className={`flex size-11 cursor-pointer items-center justify-center rounded-(--radius-ctl) text-xl ${
                    emoji === face
                      ? "border-2 border-ink bg-gold/40"
                      : "border border-slate/40 bg-chalk hover:border-ink"
                  }`}
                >
                  {face}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="grid gap-1.5 text-sm font-semibold">
            School
            <Input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              maxLength={120}
              list="profile-school-options"
              placeholder="Classmates share a board"
            />
          </label>
          <datalist id="profile-school-options">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <label className="grid gap-1.5 text-sm font-semibold">
            Year group
            <select
              value={yearGroup}
              onChange={(e) => setYearGroup(e.target.value)}
              className="w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink"
            >
              <option value="" disabled>
                Choose one
              </option>
              {YEAR_GROUPS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="text-sm text-flag" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={save}
              disabled={busy || name.trim().length === 0}
            >
              {busy ? "Saving" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate/30 pt-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate">Level</dt>
          <dd className="num font-display text-2xl font-extrabold">
            {props.level}
          </dd>
          <dd className="text-xs text-slate">
            <span className="num">{props.xp}</span> XP
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Recall days</dt>
          <dd className="num font-display text-2xl font-extrabold">
            {props.streakCurrent}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Longest run</dt>
          <dd className="num font-display text-2xl font-extrabold">
            {props.streakLongest}
          </dd>
          <dd className="text-xs text-slate">days of recall practice</dd>
        </div>
        <div>
          <dt className="text-xs text-slate">Member since</dt>
          <dd className="num pt-1.5 text-sm font-semibold">
            {props.memberSince}
          </dd>
        </div>
      </dl>
    </section>
  );
}
