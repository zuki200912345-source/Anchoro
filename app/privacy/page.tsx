import Link from "next/link";

export const metadata = { title: "Privacy policy" };

// Public page — linked from the auth screen, the profile, and the App Store
// listing (guideline 5.1.1(i)). Reachable without an account.
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Privacy policy
        </h1>
        <p className="mt-2 text-sm text-slate">
          Effective 8 August 2026 · Applies to the Anchor app and website.
        </p>
      </header>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">What we collect</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Account details.</strong> Your email address, display name,
            optional school name, year group and avatar. If you sign in with
            Google, we receive your email and name from Google.
          </li>
          <li>
            <strong>Learning activity.</strong> Your puzzle and problem
            attempts, the working you type, scores, streaks, hint usage,
            confidence ratings and review schedule. This is the product — it is
            how your progress views are built.
          </li>
          <li>
            <strong>Friend connections.</strong> Friend requests you send or
            accept, and challenge results you share.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed">
          We do not collect your precise location, contacts, photos or browsing
          history. There are no ads, no advertising identifiers and no
          third-party tracking or analytics SDKs.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">
          The AI tutor and your answers
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          When you ask for a hint or talk to the tutor, the text of your attempt
          and your tutor messages are sent to our AI provider, DeepSeek, to
          generate the reply. We send only what is needed for the hint: the
          question, the verified answer key and your attempt text. The app asks
          for your consent before the first AI request, and you can use Anchor
          without the AI tutor at all — marking is done by the app itself
          against verified answer keys, never by the AI.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">
          Where your data lives
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          Your account and learning data are stored with Supabase, our database
          and authentication provider. Data is transmitted over HTTPS and
          protected by row-level security, so an account can only read its own
          records (and what accepted friends choose to share). We do not sell
          your data to anyone.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">
          Deleting your account
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          You can delete your account at any time from{" "}
          <strong>Profile → Settings → Delete account</strong> inside the app.
          Deletion is immediate and permanent: your account, profile, attempts,
          progress, streaks and friend connections are all erased. Nothing is
          kept in a &quot;deactivated&quot; state.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">Age</h2>
        <p className="mt-3 text-sm leading-relaxed">
          Anchor is designed for secondary-school students aged 13 and over. If
          you are under 13, do not create an account. If you are a parent or
          guardian and believe a child under 13 has an account, contact us and
          we will delete it.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">Contact</h2>
        <p className="mt-3 text-sm leading-relaxed">
          Questions, data requests or reports:{" "}
          <a className="underline" href="mailto:zuki200912345@gmail.com">
            zuki200912345@gmail.com
          </a>
          . See also the <Link className="underline" href="/terms">terms of use</Link>{" "}
          and <Link className="underline" href="/support">support</Link>.
        </p>
      </section>
    </main>
  );
}
