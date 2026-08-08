import Link from "next/link";
import type { ReactNode } from "react";
import { PROXY_DISCLAIMER } from "@/lib/research/types";

// §15 of RESEARCH-SPEC.md — the honesty surface (H1–H5), written for the
// student whose numbers are being counted.
//
// Rules for anyone editing this page:
//   • Every effect size is quoted at the value the spec states. Do not round a
//     0.36 into "nearly 0.4", do not drop the "about a third of studies were
//     negative", and do not add a citation that is not already in the spec.
//   • The hypothesis and the product line are verbatim quotes. They stay quotes.
//   • Nothing here may claim intelligence, IQ or general-ability gains (A8, R2).
//   • If a claim weakens, it gets weaker here first.

export const metadata = { title: "About the evidence" };

function N({ children }: { children: ReactNode }) {
  return <span className="num">{children}</span>;
}

interface Finding {
  what: string;
  size: ReactNode;
  detail: ReactNode;
  inAnchor: string;
}

const FINDINGS: Finding[] = [
  {
    what: "Attempting before being taught (productive failure)",
    size: (
      <>
        g≈<N>0.36</N>
      </>
    ),
    detail: (
      <>
        Sinha &amp; Kapur (<N>2021</N>) found a mean effect of g≈<N>0.36</N>,
        rising to <N>0.58</N> where the design was implemented at high fidelity.
      </>
    ),
    inAnchor:
      "The attempt gate. No hint is reachable until you have submitted an attempt.",
  },
  {
    what: "Being tested rather than re-reading (retrieval practice)",
    size: (
      <>
        g≈<N>0.61</N>
      </>
    ),
    detail: (
      <>
        Adesope et al. (<N>2017</N>), across <N>217</N> studies. For secondary
        students the estimate was g≈<N>0.83</N>. The effect is strong for
        curriculum-linked recall and near transfer.
      </>
    ),
    inAnchor:
      "Daily retrieval items tied to what you are studying, and reviews that come back after a day or more.",
  },
  {
    what: "Explaining your reasoning to yourself",
    size: (
      <>
        g=<N>0.55</N>
      </>
    ),
    detail: (
      <>
        Bisra et al. (<N>2018</N>). Saying why a step works, in your own words,
        beats reading the same step again.
      </>
    ),
    inAnchor:
      "The explain-it-back prompt and the error journal, where you write why the error happened.",
  },
  {
    what: "Feedback",
    size: (
      <>
        d≈<N>0.41</N>
      </>
    ),
    detail: (
      <>
        Kluger &amp; DeNisi (<N>1996</N>). The average is positive, but about a
        third of studies found feedback made performance <em>worse</em>, mostly
        when it pointed at the person instead of the task.
      </>
    ),
    inAnchor:
      "Feedback names what was correct, where the reasoning weakened, and what to try next. It never describes you.",
  },
  {
    what: "Gamification, on cognitive outcomes",
    size: (
      <>
        g≈<N>0.49</N>
      </>
    ),
    detail: (
      <>
        Positive on average, but the estimate is unstable across studies, so it
        is treated as a design risk rather than a feature. Deci et al. (
        <N>1999</N>) found that positive competence feedback was the one reward
        type that improved motivation rather than crowding it out, at d=
        <N>0.33</N>.
      </>
    ),
    inAnchor:
      "XP is paid for independent solutions, persistence, self-explanation, self-correction and transfer. Finishing something earns nothing on its own.",
  },
];

export default function AboutTheEvidencePage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          About the evidence
        </h1>
        <p className="text-sm text-slate">
          Anchor makes a claim about how you learn. This page is that claim, the
          research behind it, and the places where the research runs out. Read it
          sceptically. That is the point of publishing it.
        </p>
      </header>

      <section className="plane p-5" aria-labelledby="testing">
        <h2
          id="testing"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          What Anchor is testing
        </h2>
        <p className="mt-2 text-sm">The product line, in full:</p>
        <blockquote className="plane-sm mt-2 bg-paper p-3 text-sm font-semibold">
          &ldquo;Use AI when it helps you think. Don&rsquo;t use AI instead of
          thinking.&rdquo; Scaffold, don&rsquo;t substitute.
        </blockquote>
        <p className="mt-3 text-sm">
          Underneath that sits one hypothesis, which the whole app exists to
          test:
        </p>
        <blockquote className="plane-sm mt-2 bg-paper p-3 text-sm">
          &ldquo;For adolescent students, an AI learning tool that requires an
          independent attempt before offering graduated, answer-withholding
          hints — and that fades assistance as competence grows — will produce
          better unaided performance, delayed retention, and transfer, with
          greater persistence, than the same tool offering answers on demand,
          without sacrificing engagement.&rdquo;
        </blockquote>
        <p className="mt-3 text-sm">
          In plain terms: making you try first, giving hints that withhold the
          answer, and pulling that help back as you improve should leave you
          better at the work on your own than a tool that answers on demand. It
          is a hypothesis. It is not a finding about you.
        </p>
      </section>

      <section className="plane p-5" aria-labelledby="sizes">
        <h2
          id="sizes"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          How to read the numbers
        </h2>
        <p className="mt-2 text-sm">
          g and d are effect sizes. They say how large a difference is, measured
          in standard deviations, across the studies that were pooled. As a
          rough guide, <N>0.2</N> is small, <N>0.5</N> is moderate and{" "}
          <N>0.8</N> is large. Most of what Anchor is built on sits between{" "}
          <N>0.36</N> and <N>0.61</N>: real, and not miraculous.
        </p>
        <p className="mt-2 text-sm text-slate">
          An average effect also says nothing about what happens to one person.
          Meta-analyses pool groups; you are not a group.
        </p>
      </section>

      <section aria-labelledby="says" className="flex flex-col gap-3">
        <h2
          id="says"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          What the evidence says
        </h2>
        {FINDINGS.map((finding) => (
          <section key={finding.what} className="plane flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-base font-extrabold tracking-tight">
                {finding.what}
              </h3>
              <span className="shrink-0 font-display text-xl font-extrabold leading-none">
                {finding.size}
              </span>
            </div>
            <p className="text-sm text-slate">{finding.detail}</p>
            <p className="plane-sm bg-paper p-2.5 text-sm">
              <span className="font-semibold">In Anchor. </span>
              {finding.inAnchor}
            </p>
          </section>
        ))}
        <p className="text-sm text-slate">
          One more, about the AI itself: Magesh et al. (<N>2024</N>) found that
          legal research tools which ground answers in retrieved documents still
          produced incorrect answers between <N>17%</N> and <N>33%</N> of the
          time. That is why a hint in Anchor is checked against a verified answer
          key, and why a hint that cannot be checked is replaced with a generic
          strategy prompt instead of a guess.
        </p>
      </section>

      <section className="plane p-5" aria-labelledby="not">
        <h2
          id="not"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          What the evidence does not say
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Brain training does not produce far transfer. Simons et al. (
            <N>2016</N>) and Melby-Lervåg et al. (<N>2016</N>) reviewed the field
            and found that practice makes you better at the practised task and at
            things close to it, not at thinking in general.
          </li>
          <li>
            So Anchor does not claim to raise intelligence, IQ or general
            ability, and it will not start. The puzzles are practice items, and
            that is all they are described as.
          </li>
          <li>
            Nothing in the app measures a psychological construct. There is no
            validated test in here.
          </li>
        </ul>
      </section>

      <section className="plane p-5" aria-labelledby="limits">
        <h2
          id="limits"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          The limits
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Most of the evidence for the countermeasures comes from adults,
            university students, or from before generative AI existed. Applying
            it to a teenager working with an AI tutor is inference, not a
            finding.
          </li>
          <li>
            The effect sizes are modest. Real, but not miraculous. Anyone
            promising a transformation is selling something.
          </li>
          <li>
            No longitudinal evidence exists over the timescales that actually
            matter: years of AI use across school. Nobody has that data, this app
            included.
          </li>
          <li>
            Anchor treats its own strong claims as hypotheses. The features are
            instrumented so the claims can be tested, including the ones that
            would embarrass us.
          </li>
        </ul>

        <h3 className="mt-4 font-display text-base font-extrabold tracking-tight">
          The studies that motivate the problem are the weakest ones
        </h3>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Gerlich (<N>2025</N>) is correlational, n=<N>666</N>. It can show
            that AI use and critical-thinking scores move together. It cannot
            show that one causes the other.
          </li>
          <li>
            Kosmyna and colleagues (MIT, <N>2025</N>) is a non-peer-reviewed
            preprint with n=<N>54</N>, measuring EEG during essay writing. Small,
            and not yet reviewed.
          </li>
          <li>
            Kestin et al. (<N>2025</N>, <em>Scientific Reports</em>{" "}
            <N>15:17458</N>) is a crossover RCT with N=<N>194</N>, run at a
            single institution. Good evidence, one setting.
          </li>
        </ul>
        <p className="mt-3 text-sm">
          Together they are motivating context for building this, not proof that
          it works.
        </p>
      </section>

      <section className="plane p-5" aria-labelledby="yours">
        <h2
          id="yours"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          What that means for your numbers
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Every figure in your independence profile is a behavioural proxy.{" "}
            {PROXY_DISCLAIMER}
          </li>
          <li>
            The interval is part of the number. &ldquo;<N>68%</N> ±{" "}
            <N>9</N>, from <N>42</N> attempts&rdquo; means the honest reading is
            somewhere in the high fifties to high seventies, not exactly{" "}
            <N>68</N>.
          </li>
          <li>
            There is no single score, and there is not going to be one. A
            composite of accuracy, time, hint use and retention is not a
            validated construct.
          </li>
          <li>
            If the app ever tells you something confident about who you are,
            that is a defect. Report it.
          </li>
        </ul>
        <Link
          href="/independence"
          className="mt-3 inline-flex min-h-11 items-center font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
        >
          Back to your independence profile
        </Link>
      </section>
    </div>
  );
}
