"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updatePasswordAction, type AuthActionState } from "../actions";

const EMPTY: AuthActionState = {};

export function ResetForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, EMPTY);

  return (
    <Card className="w-full">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        Set a new password
      </h1>
      <p className="mt-2 text-sm text-slate">
        Pick something you haven&apos;t used here before. 8 characters minimum.
      </p>
      <form action={action} className="mt-5 grid gap-3">
        <label className="grid gap-1.5 text-sm font-semibold">
          New password
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Repeat it
          <Input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        {state.error && (
          <p className="text-sm text-flag" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          Set new password
        </Button>
      </form>
    </Card>
  );
}
