"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfileRow } from "@/lib/database.types";

export interface SettingsCardProps {
  userId: string;
  // R3: opt-in to the improvement / independence boards. Default off.
  leaderboardOptIn: boolean;
  reminderTime: string | null; // "HH:MM" or null
  timezone: string;
}

export function SettingsCard(props: SettingsCardProps) {
  const router = useRouter();
  const [publicBoard, setPublicBoard] = useState(props.leaderboardOptIn);
  const [reminder, setReminder] = useState(props.reminderTime ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // App Store guideline 5.1.1(v): full account deletion, in-app, immediate.
  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Deletion failed. Try again.");
      }
      await createClient().auth.signOut();
      router.replace("/auth?deleted=1");
    } catch (e) {
      setDeleting(false);
      setDeleteError(e instanceof Error ? e.message : "Deletion failed. Try again.");
    }
  }

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  async function write(patch: Partial<ProfileRow>): Promise<boolean> {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", props.userId);
    if (updateError) return false;
    flashSaved();
    return true;
  }

  async function toggleLeaderboard() {
    const next = !publicBoard;
    setError(null);
    setPublicBoard(next); // optimistic
    const ok = await write({ leaderboard_opt_in: next });
    if (!ok) {
      setPublicBoard(!next);
      setError("The setting didn't save. Try again.");
    }
  }

  async function changeReminder(value: string) {
    const before = reminder;
    setError(null);
    setReminder(value); // optimistic
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return; // partial input
    const ok = await write({ reminder_time: value });
    if (!ok) {
      setReminder(before);
      setError("The reminder time didn't save. Try again.");
    }
  }

  return (
    <section className="plane p-5" aria-label="Settings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold tracking-tight">
          Settings
        </h2>
        <span aria-live="polite" className="text-sm text-slate">
          {saved ? "Saved" : ""}
        </span>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <p id="public-board-label" className="text-sm font-semibold">
            Put me on the improvement boards
          </p>
          <p className="mt-0.5 text-xs text-slate">
            Off by default. On, you&apos;re compared with people at your level
            on how much you improve and how much you do without help, over the
            last seven days. Never on a top score.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={publicBoard}
          aria-labelledby="public-board-label"
          onClick={toggleLeaderboard}
          className="flex min-h-11 cursor-pointer items-center"
        >
          <span
            aria-hidden
            className={`flex h-7 w-12 items-center rounded-(--radius-ctl) border border-ink px-1 transition-colors ${
              publicBoard ? "justify-end bg-ink" : "justify-start bg-chalk"
            }`}
          >
            <span
              className={`size-4.5 rounded-[1px] ${
                publicBoard ? "bg-gold" : "bg-slate/60"
              }`}
            />
          </span>
        </button>
      </div>

      <label className="mt-5 grid max-w-48 gap-1.5 text-sm font-semibold">
        Daily reminder
        <Input
          type="time"
          value={reminder}
          onChange={(e) => changeReminder(e.target.value)}
          className="num"
        />
      </label>

      <div className="mt-5 text-sm">
        <p className="font-semibold">Timezone</p>
        <p className="mt-0.5 text-slate">
          {props.timezone}. Streaks and daily sessions follow this zone.
        </p>
      </div>

      {error && (
        <p className="mt-3 text-sm text-flag" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 border-t border-slate/30 pt-4">
        <p className="text-sm font-semibold">Delete account</p>
        <p className="mt-0.5 text-xs text-slate">
          Immediate and permanent. Your profile, attempts, progress, streaks
          and friend connections are all erased. There is no
          &quot;deactivated&quot; state and no way back.
        </p>

        {!confirmingDelete ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-3 min-h-11"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete my account
          </Button>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <label className="grid gap-1.5 text-sm font-semibold">
              Type DELETE to confirm
              <Input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                autoComplete="off"
                className="max-w-48"
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteText("");
                  setDeleteError(null);
                }}
                disabled={deleting}
              >
                Keep my account
              </Button>
              <Button
                type="button"
                onClick={deleteAccount}
                disabled={deleting || deleteText.trim() !== "DELETE"}
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
            {deleteError && (
              <p className="text-sm text-flag" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
