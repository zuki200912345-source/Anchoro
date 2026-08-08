"use client";

// Live countdown to local midnight — when tomorrow's session opens.

import { useEffect, useState } from "react";

export function MidnightCountdown() {
  const [text, setText] = useState("--:--:--");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const ms = midnight.getTime() - now.getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setText(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="num text-2xl" role="timer" aria-label="time until tomorrow's session">
      {text}
    </span>
  );
}
