You need a GitHub account. Vercel and Convex accounts are created along the way. Both are free for personal use,
but Vercel's Hobby plan is for non-commercial use only.

## Deploy

1. **Click "Deploy with Vercel"** on the [Pantry repo](https://github.com/honeynjam/pantry) and sign in to Vercel
   with GitHub.
2. **Repository:** Vercel copies the repo into your GitHub account (a clone, not a fork). Keep the name or change it.
3. **Root Directory** is already set to `apps/web` by the button. Leave it, and leave the build and install
   settings alone. If the form shows the repo root instead, click **Edit** next to Root Directory and pick
   `apps/web`.
4. **Add the Convex integration** when Vercel asks (it's pre-selected): accept the terms and create a new Convex
   project. Keep both **Production** and **Preview** enabled and leave **Custom Prefix** empty.
5. **Deploy.** The build deploys your Convex functions, creates the auth secret on your Convex deployment (once;
   it survives redeploys), points Convex at your production URL and builds the web app.
6. **Open your production URL** (`https://<project>.vercel.app`). The setup screen creates your account and
   workspace. You become the owner, and from then on sign-up is invite-only.

Then [onboarding](/docs/onboarding) starts.

> If the setup screen says **"One more step"**, the deploy key wasn't allowed to set environment variables. Copy
> the one-line command it shows (run it from `packages/backend` in a clone, with `--prod`), or add
> `BETTER_AUTH_SECRET` in the Convex dashboard → Settings → Environment Variables, then reload.

## What runs where

- **Vercel** serves the web app and the MCP endpoint (`/api/mcp`).
- **Convex** holds your data and runs every change, so all screens update live.
- Only production deploys run. Preview builds are skipped, so they never touch your Convex data. Every push to your
  repo's production branch redeploys the web app and Convex together, and runs any data migrations.

## Check it's healthy

`GET https://<your-app>/api/instance` returns your instance's name, its Convex URLs, the server version and whether
the auth secret is still missing (`"needsSecret": false` when it's fine). If something's off, see
[Troubleshooting](/docs/troubleshooting).

## Your own domain

In Vercel, open the project → Settings → Domains and add it. Then redeploy, so sign-in uses the new address.
