import Link from "next/link";

export const metadata = { title: "Support" };

// Public support page — this URL goes in the App Store listing's Support URL
// field (guideline 1.5), so it must work without an account.
export default function SupportPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Support
        </h1>
        <p className="mt-2 text-sm text-slate">
          Stuck, found a bug, or need something fixed? This is the place.
        </p>
      </header>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">Contact us</h2>
        <p className="mt-3 text-sm leading-relaxed">
          Email{" "}
          <a className="underline" href="mailto:zuki200912345@gmail.com">
            zuki200912345@gmail.com
          </a>{" "}
          and we will get back to you. Include the email address on your
          account if your question is about your data or progress.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">
          Report a player or content
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          If a display name, avatar or challenge message is offensive or makes
          you uncomfortable, email us with the player&apos;s display name and
          what happened. Reports are reviewed by a person and acted on quickly.
        </p>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold">Common questions</h2>
        <dl className="mt-3 flex flex-col gap-4 text-sm leading-relaxed">
          <div>
            <dt className="font-semibold">How do I delete my account?</dt>
            <dd className="mt-1 text-slate">
              Profile → Settings → Delete account. It is immediate and
              permanent.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Why won&apos;t the app give me the answer?</dt>
            <dd className="mt-1 text-slate">
              By design. You attempt first; hints open one step at a time, and
              the worked solution appears only after real work. That is what
              makes the practice stick.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Where does my data go?</dt>
            <dd className="mt-1 text-slate">
              Read the <Link className="underline" href="/privacy">privacy policy</Link>{" "}
              — it is short and honest.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
