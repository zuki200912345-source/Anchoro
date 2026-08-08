#!/bin/bash
# §12 static audits: banned copy, banned design patterns. Run from repo root.
set -u
fail=0

code_dirs="app components lib"

echo "-- banned vocabulary (§8) --"
# Word-boundary matches in ts/tsx source only; docs may quote the ban list.
banned="delve|seamless|robust|leverage|elevate|empower|unlock|harness|tapestry|realm|journey|landscape|testament|underscore|showcase|foster|pivotal|crucial|meticulous|intricate|vibrant|transformative|unleash|supercharge|game-changer|cutting-edge|holistic|curated|bespoke"
# Exclude: identifiers around the achievements schema (unlocked_at,
# unlockedKeys), the ai.ts system prompt that QUOTES the ban list at the
# model, and comment-only lines.
if grep -rniE "\b($banned)" $code_dirs --include='*.tsx' --include='*.ts' \
  | grep -viE "unlocked_at|unlockedkeys|data: unlocked|\(unlocked|Never use these words|tapestry, realm|showcase, foster|unleash, supercharge|ship-check|unlock\|delve" \
  | grep -vE ":[0-9]+:\s*(//|\*|/\*)"; then
  echo "FAIL: banned words found"
  fail=1
else
  echo "ok"
fi

echo "-- banned constructions (§8) --"
if grep -rniE "it's not just|has you covered|picture this|imagine a world" $code_dirs --include='*.tsx' --include='*.ts'; then
  echo "FAIL: banned constructions found"
  fail=1
else
  echo "ok"
fi

echo "-- design bans (§7): purple/indigo/violet --"
if grep -rniE "purple|indigo|violet|#[89ab][0-9a-f][0-9a-f]?f[0-9a-f]?f" $code_dirs --include='*.tsx' --include='*.ts' --include='*.css'; then
  echo "FAIL: purple-family reference found"
  fail=1
else
  echo "ok"
fi

echo "-- design bans (§7): Inter, backdrop-blur, colored left borders --"
if grep -rnE "font-\[?'?\"?Inter|backdrop-blur|border-l-2|border-l-4|border-l-\[" $code_dirs --include='*.tsx' --include='*.ts' --include='*.css'; then
  echo "FAIL: banned design pattern found"
  fail=1
else
  echo "ok"
fi

echo "-- em dashes in UI strings (max 1 per screen; flag all for review) --"
grep -rn "—" $code_dirs --include='*.tsx' --include='*.ts' | grep -v "^\s*//" | grep -viE "aria-|//|/\*|\* " || echo "ok"

exit $fail
