# Project H.O.O.D. — Website Admin

A calm admin app for the Project H.O.O.D. website. **Phase 2, first vertical slice:**
magic-link auth, an app shell with full navigation, a live Dashboard, and a fully
wired Events screen backed by Supabase. Deploys to Vercel with serverless functions
for the publish flow and public RSVP intake.

> This app is **separate** from the public site (which is static HTML on GitHub Pages).
> It manages *operational* data (users, events, RSVPs, activity/publish logs). Website
> *content* stays in the site's Git repo.

## Stack
- Vite + React 18, react-router-dom v6
- @supabase/supabase-js v2 (auth + data)
- Vercel serverless functions (Node ESM) under `/api`
- Plain CSS (calm design system ported from the prototype) — no Tailwind

## Prerequisites
- Node 18+ (built/tested on Node 22)
- A Supabase project with `Phase2_supabase_schema.sql` applied
- A GitHub personal access token with `repo` scope (for the publish flow)

## Local development
```bash
npm install
cp .env.example .env      # then fill in real values
npm run dev               # http://localhost:5173
```

Log in with a staff email — Supabase sends a magic link. After first login,
promote yourself to owner in the Supabase SQL editor:
```sql
update public.profiles set role='owner' where email='brian@projecthood.org';
```

> Note: the `/api/*` serverless functions do **not** run under `vite dev`. To exercise
> the publish/RSVP endpoints locally, use `vercel dev` (Vercel CLI). Otherwise the
> Dashboard's "Site status" card will show a friendly "couldn't reach publish service"
> state — expected in plain `vite dev`.

## Build
```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Environment variables

### Client (browser-exposed — safe; protected by RLS)
Set locally in `.env` and in Vercel:
| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |

### Server (Vercel functions only — **secret, never exposed to the browser**)
Set **only** in Vercel project settings (and `.env` for `vercel dev`):
| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — bypasses RLS. Server only. |
| `GITHUB_TOKEN` | PAT with `repo` scope for compare/merge. Server only. |
| `GITHUB_REPO` | e.g. `projecthood-site/projecthood` |
| `GITHUB_STAGING_BRANCH` | defaults to `staging` |
| `GITHUB_MAIN_BRANCH` | defaults to `main` |

Do **not** prefix the server vars with `VITE_` — that would inline them into the
client bundle. The service-role key and GitHub token must stay server-side.

## Deploying to Vercel
1. Push this folder to a Git repo and import it in Vercel.
2. Vercel auto-detects Vite (build `npm run build`, output `dist/`) and the
   functions in `/api`.
3. In **Project Settings → Environment Variables**, add all variables above.
   The client `VITE_*` pair is safe to expose; keep the server vars secret.
4. In Supabase **Auth → URL Configuration**, add your Vercel URL to the allowed
   redirect URLs so magic links return to the app.

## What's wired vs. stubbed
- **Wired to Supabase/GitHub:** Login (magic link), session gate, Dashboard site
  status + publish, upcoming-events KPI, activity feed, full Events screen
  (list, create, status changes, RSVP counts), `/api/publish`, `/api/rsvp`.
- **Stubbed ("Coming soon — Phase 2"):** Pages, Programs, Impact Stats, Donations,
  News & Stories, Media, Volunteers, Team & Roles, Settings. Nav routes to them so
  the shell is complete; screens land in later Phase 2 work.
- **Placeholder values:** three Dashboard KPI cards (donations, visitors, volunteers)
  show clearly-labelled placeholders until those data sources are wired.
