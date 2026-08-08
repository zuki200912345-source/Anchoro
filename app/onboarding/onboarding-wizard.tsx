"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Calibration, type CalibrationResults } from "./calibration";

const AVATARS = [
  "🦊", "🐸", "🦉", "🐙", "🦖", "🐝",
  "🐢", "🦈", "🐇", "🦫", "🐊", "🦩",
  "🐞", "🐐", "🦭", "🐌", "🦅", "🐺",
  "🦋", "🐧", "🐘", "🦔", "🐆", "🐋",
];

export const YEAR_GROUPS = [
  "Year 9",
  "Year 10",
  "Year 11",
  "Year 12",
  "Year 13",
  "Uni",
  "Other",
] as const;

const STEP_TITLES = [
  "Pick your name",
  "Where you study",
  "Three quick checks",
  "Daily reminder",
];

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);

  const [school, setSchool] = useState("");
  const [schoolPicked, setSchoolPicked] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [yearGroup, setYearGroup] = useState("");

  const [calibration, setCalibration] = useState<CalibrationResults | null>(null);

  const [reminderTime, setReminderTime] = useState("16:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // School autocomplete against schools other players already entered.
  useEffect(() => {
    const q = school.trim();
    if (step !== 1 || schoolPicked || q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/schools?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { schools?: string[] };
        setSuggestions((body.schools ?? []).filter((s) => s !== q));
      } catch {
        // No suggestions; free text still works.
      }
    }, 200);
    return () => clearTimeout(t);
  }, [school, schoolPicked, step]);

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          avatar_emoji: avatarEmoji,
          school: school.trim() || null,
          year_group: yearGroup,
          reminder_time: reminderTime,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          calibration: calibration ?? {
            pattern: false,
            mental_math: false,
            memory: false,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Saving didn't finish. Try again.");
        setSubmitting(false);
        return;
      }
      router.replace("/today");
    } catch {
      setError("The request didn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full">
      <div className="flex items-center justify-between">
        <div
          role="img"
          aria-label={`step ${step + 1} of 4`}
          className="flex gap-1.5"
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`size-2.5 rounded-[1px] ${
                i <= step ? "bg-flag" : "border border-slate/60"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-slate">
          <span className="num">{step + 1}</span> /{" "}
          <span className="num">4</span>
        </p>
      </div>

      <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight">
        {STEP_TITLES[step]}
      </h1>

      {step === 0 && (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold">
            Display name
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
              placeholder="What the leaderboard calls you"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold">
              Face <span className="font-normal text-slate">(optional)</span>
            </legend>
            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={avatarEmoji === emoji}
                  aria-label={`avatar ${emoji}`}
                  onClick={() =>
                    setAvatarEmoji(avatarEmoji === emoji ? null : emoji)
                  }
                  className={`flex size-11 cursor-pointer items-center justify-center rounded-(--radius-ctl) text-xl ${
                    avatarEmoji === emoji
                      ? "border-2 border-ink bg-gold/40"
                      : "border border-slate/40 bg-chalk hover:border-ink"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </fieldset>
          <Button
            type="button"
            disabled={displayName.trim().length === 0}
            onClick={() => setStep(1)}
          >
            Next
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="mt-4 grid gap-4">
          <div className="relative">
            <label className="grid gap-1.5 text-sm font-semibold">
              School{" "}
              <span className="sr-only">
                start typing to see schools already on Anchor
              </span>
              <Input
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setSchoolPicked(false);
                }}
                maxLength={120}
                placeholder="Start typing, classmates share a board"
              />
            </label>
            {suggestions.length > 0 && (
              <ul className="plane-sm absolute inset-x-0 top-full z-10 mt-1 overflow-hidden">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="w-full cursor-pointer px-3 py-2.5 text-left text-sm hover:bg-paper"
                      onClick={() => {
                        setSchool(s);
                        setSchoolPicked(true);
                        setSuggestions([]);
                      }}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep(0)}
            >
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={yearGroup === ""}
              onClick={() => setStep(2)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4">
          <p className="text-sm text-slate">
            One from each category. They set your starting difficulty, nothing
            else, so guessing hurts more than a slow right answer.
          </p>
          <div className="mt-4">
            <Calibration
              onDone={(results) => {
                setCalibration(results);
                setStep(3);
              }}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-slate">
            One nudge a day, at a time you pick. Change it later from your
            profile.
          </p>
          <label className="grid gap-1.5 text-sm font-semibold">
            Reminder time
            <Input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="num"
              required
            />
          </label>
          {error && (
            <p className="text-sm text-flag" role="alert">
              {error}
            </p>
          )}
          <Button type="button" disabled={submitting} onClick={finish}>
            Finish setup
          </Button>
        </div>
      )}
    </Card>
  );
}
