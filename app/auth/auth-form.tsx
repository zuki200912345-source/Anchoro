"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  requestResetAction,
  signInAction,
  signUpAction,
  type AuthActionState,
} from "./actions";
import { OAuthButtons } from "./oauth-buttons";

type View = "signin" | "signup" | "forgot";

const EMPTY: AuthActionState = {};

export function AuthForm({
  initialMode,
  next,
  refCode,
  errorMessage,
}: {
  initialMode: "signin" | "signup";
  next: string;
  refCode: string;
  errorMessage: string | null;
}) {
  const [view, setView] = useState<View>(initialMode);
  const [signUpState, signUp, signUpPending] = useActionState(signUpAction, EMPTY);
  const [signInState, signIn, signInPending] = useActionState(signInAction, EMPTY);
  const [resetState, requestReset, resetPending] = useActionState(
    requestResetAction,
    EMPTY,
  );
  // Tracks which "email sent" state the user has dismissed; a fresh submit
  // produces a new state object, so the inbox screen shows again.
  const [dismissed, setDismissed] = useState<AuthActionState | null>(null);

  const sent =
    signUpState.sent && signUpState !== dismissed
      ? signUpState
      : resetState.sent && resetState !== dismissed
        ? resetState
        : null;

  if (sent) {
    return (
      <Card className="w-full">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          Check your inbox
        </h1>
        <p className="mt-3 text-sm">
          {sent.sent === "confirm"
            ? `A confirmation link is on its way to ${sent.email}. Open it to finish creating your account.`
            : `A reset link is on its way to ${sent.email}. Open it on this device to set a new password.`}
        </p>
        <p className="mt-2 text-sm text-slate">
          Nothing after a few minutes? Check spam, then send it again.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-5"
          onClick={() => {
            setDismissed(sent);
            setView("signin");
          }}
        >
          Back to sign in
        </Button>
      </Card>
    );
  }

  const labelCls = "grid gap-1.5 text-sm font-semibold";

  return (
    <Card className="w-full">
      {errorMessage && (
        <p className="mb-4 rounded-(--radius-ctl) border border-flag px-3 py-2 text-sm text-flag">
          {errorMessage}
        </p>
      )}

      {view === "forgot" ? (
        <>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-slate">
            Enter your email and we&apos;ll send a link that lets you set a new
            one.
          </p>
          <form action={requestReset} className="mt-5 grid gap-3">
            <label className={labelCls}>
              Email
              <Input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@school.ac.uk"
              />
            </label>
            {resetState.error && (
              <p className="text-sm text-flag" role="alert">
                {resetState.error}
              </p>
            )}
            <Button type="submit" disabled={resetPending}>
              Send reset link
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 cursor-pointer text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
            onClick={() => setView("signin")}
          >
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <div className="plane-sm grid grid-cols-2 gap-1 p-1" role="group" aria-label="sign in or create account">
            <button
              type="button"
              aria-pressed={view === "signin"}
              onClick={() => setView("signin")}
              className={`cursor-pointer rounded-(--radius-ctl) px-3 py-2 text-sm font-semibold transition-colors ${
                view === "signin" ? "bg-ink text-chalk" : "text-slate hover:text-ink"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={view === "signup"}
              onClick={() => setView("signup")}
              className={`cursor-pointer rounded-(--radius-ctl) px-3 py-2 text-sm font-semibold transition-colors ${
                view === "signup" ? "bg-ink text-chalk" : "text-slate hover:text-ink"
              }`}
            >
              Create account
            </button>
          </div>

          {view === "signup" ? (
            <form action={signUp} className="mt-5 grid gap-3">
              <input type="hidden" name="ref" value={refCode} />
              <label className={labelCls}>
                Email
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@school.ac.uk"
                />
              </label>
              <label className={labelCls}>
                Password
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="8 characters minimum"
                />
              </label>
              {signUpState.error && (
                <p className="text-sm text-flag" role="alert">
                  {signUpState.error}
                </p>
              )}
              <Button type="submit" disabled={signUpPending}>
                Create account
              </Button>
            </form>
          ) : (
            <form action={signIn} className="mt-5 grid gap-3">
              <input type="hidden" name="next" value={next} />
              <label className={labelCls}>
                Email
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@school.ac.uk"
                />
              </label>
              <label className={labelCls}>
                Password
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              {signInState.error && (
                <p className="text-sm text-flag" role="alert">
                  {signInState.error}
                </p>
              )}
              <Button type="submit" disabled={signInPending}>
                Sign in
              </Button>
              <button
                type="button"
                className="cursor-pointer justify-self-start text-sm underline decoration-slate underline-offset-4 hover:decoration-ink"
                onClick={() => setView("forgot")}
              >
                Forgot your password?
              </button>
            </form>
          )}

          <div className="my-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-slate/40" />
            <span className="text-xs text-slate">or</span>
            <span className="h-px flex-1 bg-slate/40" />
          </div>

          <OAuthButtons next={next} />
        </>
      )}
    </Card>
  );
}
