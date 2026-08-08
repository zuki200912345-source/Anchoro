import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";

// Shell for every signed-in page. Middleware already guards these routes;
// the user check here is a second line, not the gate.
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_emoji, streak_current")
    .eq("id", user.id)
    .single();

  // No display name means onboarding never finished.
  if (!profile?.display_name) redirect("/onboarding");

  return (
    <div className="min-h-dvh">
      <Nav
        displayName={profile.display_name}
        avatarEmoji={profile.avatar_emoji}
        streak={profile.streak_current}
      />
      {/* pb-24 clears the fixed bottom tab bar on mobile. */}
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pt-8">
        {children}
      </main>
    </div>
  );
}
