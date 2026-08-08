import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Autocomplete for the onboarding school field: distinct school names other
// players have already entered, most common first, max 8.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to search schools." },
      { status: 401 },
    );
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ schools: [] });
  }

  // Escape ilike wildcards so "100%" style input matches literally.
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("school")
    .not("school", "is", null)
    .ilike("school", `%${escaped}%`)
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: "School search failed. Type the full name instead." },
      { status: 500 },
    );
  }

  // Result cast: the hand-written Database types collapse to `never` under
  // supabase-js's schema constraint, so rows are typed at the call site.
  const rows = (data ?? []) as unknown as { school: string | null }[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = (row.school ?? "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const schools = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([name]) => name);

  return NextResponse.json({ schools });
}
