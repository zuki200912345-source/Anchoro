# Anchoro

Anchoro is daily cognitive training designed to reduce cognitive offloading.

You solve five short puzzles each day with no help for the first 45 seconds, then get guided hints, feedback, and progress tracking.

**Live app:** [anchoro.vercel.app](https://anchoro.vercel.app)

## Features

- Daily five-puzzle sessions across spatial, logic, pattern, memory, problem-solving, and mental-math categories
- Question-first hints that delay the answer and track hint independence
- Adaptive difficulty and category ratings
- Streaks, XP, achievements, leaderboards, friends, and challenges
- Session recaps with optional Anthropic-generated feedback
- Supabase Auth, Postgres, and row-level security

## Stack

- Next.js 15 App Router and React 19
- TypeScript with strict checking
- Tailwind CSS v4
- Supabase SSR, Postgres, Auth, and RLS
- Anthropic API for optional server-side hints and recaps
- Recharts, Zod, and Vitest
- Vercel

## Requirements

- Node.js 20+
- A Supabase project
- An Anthropic API key is optional; deterministic fallbacks are used when it is not configured

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ANTHROPIC_API_KEY=
   NEXT_PUBLIC_SITE_URL=http://localhost:5730
   NEXT_PUBLIC_APPLE_AUTH_ENABLED=false
   ```

   Keep `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` server-side.

3. Apply the migrations in `supabase/migrations` to a fresh Supabase project.

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:5730](http://localhost:5730).

## Useful commands

```bash
npm run dev       # Start local development
npm run build     # Create a production build
npm run start     # Serve the production build
npm run lint      # Run ESLint
npm test          # Run the Vitest suite
```

## Supabase configuration

In Supabase Auth, set:

- Site URL to your local or production URL
- Redirect URL to `<site-url>/auth/callback`
- Email authentication as needed
- Google OAuth credentials if Google sign-in is enabled

Apple sign-in is shipped behind `NEXT_PUBLIC_APPLE_AUTH_ENABLED`. Keep it `false` until the Apple Developer and Supabase provider setup is complete.

## Deploying to Vercel

1. Import the repository into Vercel.
2. Add the environment variables above for Production and Preview.
3. Set `NEXT_PUBLIC_SITE_URL` to your production URL.
4. Deploy with Vercel or push to the connected Git branch.
5. Add the production callback URL to Supabase Auth URL configuration.

## Security notes

- Never commit `.env.local` or service-role credentials.
- Puzzle seeds, scoring, XP, ratings, and session completion are written through protected server routes.
- Supabase RLS policies prevent clients from directly changing leaderboard and scoring data.
