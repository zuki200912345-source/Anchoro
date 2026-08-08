"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FriendRow } from "@/app/api/friends/route";

function Face({ emoji, name }: { emoji: string | null; name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-(--radius-ctl) border border-slate/40 bg-paper text-lg"
    >
      {emoji ?? name.slice(0, 1)}
    </span>
  );
}

export function FriendsCard() {
  const [rows, setRows] = useState<FriendRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/friends");
        const body = (await res.json()) as {
          friends?: FriendRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            body.error ?? "The friends list didn't load. Refresh to try again.",
          );
          return;
        }
        setRows(body.friends ?? []);
      } catch {
        if (!cancelled) {
          setLoadError("The friends list didn't load. Refresh to try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  async function addFriend(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await res.json()) as { friend?: FriendRow; error?: string };
      if (!res.ok || !body.friend) {
        setAddMsg({
          ok: false,
          text: body.error ?? "The request didn't save. Try again.",
        });
        return;
      }
      setRows((prev) => [body.friend as FriendRow, ...(prev ?? [])]);
      setCode("");
      setAddMsg({ ok: true, text: "Request sent." });
    } catch {
      setAddMsg({
        ok: false,
        text: "The request didn't reach the server. Check your connection and try again.",
      });
    } finally {
      setAdding(false);
    }
  }

  async function accept(row: FriendRow) {
    setActionError(null);
    const before = rows;
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.friendship_id === row.friendship_id
          ? { ...r, status: "accepted" as const }
          : r,
      ),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" } as never)
      .eq("id", row.friendship_id);
    if (error) {
      setRows(before);
      setActionError("The accept didn't save. Try again.");
    }
  }

  async function remove(row: FriendRow) {
    if (confirmRemove !== row.friendship_id) {
      setConfirmRemove(row.friendship_id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmRemove(null), 4000);
      return;
    }
    setConfirmRemove(null);
    setActionError(null);
    const before = rows;
    setRows((prev) =>
      (prev ?? []).filter((r) => r.friendship_id !== row.friendship_id),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", row.friendship_id);
    if (error) {
      setRows(before);
      setActionError("The remove didn't save. Try again.");
    }
  }

  const incoming = (rows ?? []).filter(
    (r) => r.status === "pending" && r.direction === "incoming",
  );
  const outgoing = (rows ?? []).filter(
    (r) => r.status === "pending" && r.direction === "outgoing",
  );
  const friends = (rows ?? []).filter((r) => r.status === "accepted");

  return (
    <section className="plane p-5" aria-label="Friends">
      <h2 className="font-display text-xl font-extrabold tracking-tight">
        Friends
      </h2>

      <form onSubmit={addFriend} className="mt-3 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="Friend code"
          aria-label="Friend code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="font-data uppercase tracking-widest"
        />
        <Button
          type="submit"
          variant="secondary"
          className="min-h-11 shrink-0"
          disabled={adding || code.trim().length < 6}
        >
          {adding ? "Adding" : "Add friend"}
        </Button>
      </form>
      {addMsg && (
        <p
          className={`mt-2 text-sm ${addMsg.ok ? "text-slate" : "text-flag"}`}
          role={addMsg.ok ? "status" : "alert"}
        >
          {addMsg.text}
        </p>
      )}

      {loadError && (
        <p className="mt-4 text-sm text-flag" role="alert">
          {loadError}
        </p>
      )}
      {!loadError && rows === null && (
        <p className="mt-4 text-sm text-slate" aria-live="polite">
          Loading friends
        </p>
      )}

      {rows !== null && (incoming.length > 0 || outgoing.length > 0) && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate">Requests</h3>
          <ul className="mt-2 grid gap-2">
            {incoming.map((r) => (
              <li
                key={r.friendship_id}
                className="flex min-h-11 items-center gap-3"
              >
                <Face emoji={r.avatar_emoji} name={r.display_name} />
                <span className="flex-1 truncate text-sm font-semibold">
                  {r.display_name}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => accept(r)}
                >
                  Accept
                </Button>
              </li>
            ))}
            {outgoing.map((r) => (
              <li
                key={r.friendship_id}
                className="flex min-h-11 items-center gap-3"
              >
                <Face emoji={r.avatar_emoji} name={r.display_name} />
                <span className="flex-1 truncate text-sm font-semibold">
                  {r.display_name}
                </span>
                <span className="text-xs text-slate">waiting</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows !== null && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate">
            Added <span className="num">{friends.length}</span>
          </h3>
          {friends.length === 0 ? (
            <p className="mt-2 text-sm text-slate">
              No friends yet. Swap codes with a classmate and add theirs above.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {friends.map((r) => (
                <li
                  key={r.friendship_id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Face emoji={r.avatar_emoji} name={r.display_name} />
                  <span className="flex-1 truncate text-sm font-semibold">
                    {r.display_name}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-11"
                    aria-label={
                      confirmRemove === r.friendship_id
                        ? `confirm removing ${r.display_name}`
                        : `remove ${r.display_name}`
                    }
                    onClick={() => remove(r)}
                  >
                    {confirmRemove === r.friendship_id
                      ? "Sure? Remove"
                      : "Remove"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {actionError && (
        <p className="mt-3 text-sm text-flag" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}
