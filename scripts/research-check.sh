#!/bin/bash
# Static audit of the research-spec hard rules (RESEARCH-SPEC.md). Complements
# scripts/ship-check.sh (banned copy + design bans), which it also runs.
set -u
fail=0
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here" || exit 2

code="app components lib"
ui="app components"

echo "== research-check =="

echo "-- no intelligence / IQ / brain-training claims (A8, R2) --"
# User-facing strings only. Allow the honesty page to NAME the rejected claim
# when it is explaining that Anchor does NOT make it.
hits=$(grep -rniE "\b(iq|intelligence|brain[ -]?training|smarter|genius|cognitive enhancement|boost your brain|get smarter)\b" \
  $ui --include='*.tsx' --include='*.ts' \
  | grep -viE "about-the-evidence|does not claim|not a claim|no far transfer|not brain training|RESEARCH-SPEC|// " || true)
if [ -n "$hits" ]; then echo "$hits"; echo "FAIL: intelligence/brain-training claim in UI"; fail=1; else echo "ok"; fi

echo "-- no composite score displayed (R1) --"
# cognitive_score may be READ in server compute (engine/attempt) and TYPED, but
# must not be rendered as a headline number in a page/component.
hits=$(grep -rniE "cognitive[ _]?score" $ui --include='*.tsx' \
  | grep -viE "no (single|composite|combined) (number|score)|not reduce|deprecated|RESEARCH-SPEC|independence|// " || true)
if [ -n "$hits" ]; then echo "$hits"; echo "FAIL: composite score referenced in UI"; fail=1; else echo "ok"; fi

echo "-- the attempt is the gate: hint/stuck/solution routes enforce it (B1, B4) --"
missing=""
# The gate lives in ../_lib/help (escalate / helpGate); routes may enforce it
# directly or by delegating there. Accept either.
for r in hint stuck solution; do
  f="app/api/learn/$r/route.ts"
  if [ -f "$f" ]; then
    grep -qiE "escalate|helpGate|attemptsBeforeHelp|attemptsBeforeSolution|attemptsMade|nextHelpAvailable|revealSolution|403" "$f" \
      || missing="$missing $r"
  else
    missing="$missing $r(absent)"
  fi
done
# And confirm the gate function itself exists and references the policy.
if [ -f "app/api/learn/_lib/help.ts" ]; then
  grep -qiE "helpGate|attemptsBeforeHelp|SUPPORT_POLIC" "app/api/learn/_lib/help.ts" \
    || missing="$missing _lib/help(no-gate)"
fi
if [ -n "$missing" ]; then echo "  ungated or missing:$missing"; echo "FAIL: a help route does not enforce the attempt gate"; fail=1; else echo "ok"; fi

echo "-- answer keys never reach a client component (I3) --"
hits=$(grep -rniE "answer_key|worked_solution|common_misconceptions" \
  $ui --include='*.tsx' | grep -viE "RESEARCH-SPEC|never|// " || true)
if [ -n "$hits" ]; then echo "$hits"; echo "FAIL: a secret item field appears in a client file"; fail=1; else echo "ok"; fi

echo "-- XP is not completion-based in the session route (R4) --"
if grep -q "xpForPuzzle" "app/api/session/[id]/attempt/route.ts" 2>/dev/null; then
  echo "  attempt route still calls xpForPuzzle"; echo "FAIL: completion XP still wired"; fail=1
else echo "ok"; fi

echo "-- proxy disclaimer present where metrics are shown (M5) [WARN] --"
for p in "app/(app)/independence/page.tsx" "app/(app)/dashboard/page.tsx"; do
  if [ -f "$p" ]; then
    grep -qiE "ProxyNote|PROXY_DISCLAIMER|proxy|behavioural proxy|not a test" "$p" \
      || echo "  WARN: $p shows metrics without a visible proxy note"
  fi
done
echo "ok (warnings above, if any)"

echo "== ship-check (copy + design bans) =="
if [ -x scripts/ship-check.sh ]; then
  bash scripts/ship-check.sh || fail=1
else
  echo "ship-check.sh not found — skipping"
fi

exit $fail
