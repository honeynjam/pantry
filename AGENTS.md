# Pantry

Open-source (MIT) Linear-style issue tracker for either individuals or small teams working with AI coding agents.
Full spec: docs/PANTRY-SPEC.md. Its §10b "Build plan" (versions, schema, functions, MCP tools, tasks,
acceptance criteria) wins over the summaries elsewhere. Build only what the current task lists.
Open questions (spec §12): if Kris hasn't answered one, use its ★ default and keep going.

This is the one agent rules file: CLAUDE.md only imports it. Packages with their own rules have a scoped
AGENTS.md (and a CLAUDE.md that imports it); read it before you change that package:
packages/backend (Convex rules), packages/app (client-only, shortcuts, optimistic updates),
packages/ui (design system and motion). apps/web/AGENTS.md is written by `next dev`; leave it alone.

## Working rules

- Never deploy or publish: no `vercel`, `npx convex deploy`, `npx convex env set` on a cloud deployment,
  `git push`, `npm publish`, app signing or GitHub releases. Kris runs anything that needs real accounts.

## Stack

pnpm + Turborepo, Node 24. Next.js 16 App Router (apps/web), Convex (packages/backend/convex),
Better Auth via @convex-dev/better-auth 0.12.6 (better-auth pinned ~1.6.33, never 1.7), Tailwind v4,
shadcn/ui on Base UI with our design system (packages/ui), MCP via mcp-handler 2.x (packages/mcp, served at apps/web /api/mcp),
Tauri v2 Mac app (apps/desktop, v0.2 / phase 2), one-page landing site (apps/site, M6).

## Rules

- All business logic lives in Convex functions. apps/* and packages/mcp are thin adapters.
  The server rules (auth guards, activity rows, status changes, sub-issues, tokens, schema changes) are in
  packages/backend/AGENTS.md.
- packages/app is client-only: no next/* imports, no server components (it must build statically for Tauri).
- Model: Workspace → Space → Project → Issue. A space (product or client) owns the issue key, counter, context doc
  and views; a project is an optional workstream inside one space. An issue's project must be in its space.
- Product name, default issue key and token prefix come only from packages/backend/convex/lib/brand.ts
  ({ name: "Pantry", defaultKey: "PAN", tokenPrefix: "pan_" }).
- Use packages/ui components (shadcn on Base UI, restyled to our tokens) before writing new UI; no stock-looking shadcn.
- Animate only with the motion tokens in packages/ui, and give every animation a reduced-motion branch.
- Do not build: GitHub PR integration of any kind, agents as members/assignees or agents running inside the app,
  a public REST API, webhooks, saved views UI, cycles, AI helpers, appearance themes,
  local mode, the Mac app beyond the existing apps/desktop spike (v0.2), a hosted plan, Cloudflare deploy,
  or anything on the spec's "Never" list.

## Commands

pnpm i · pnpm dev · pnpm check (what CI runs) · pnpm fix
Convex without a login (agent feedback loop): cd packages/backend && CONVEX_AGENT_MODE=anonymous npx convex dev --once
Versions: never edit them by hand; `pnpm set-version X.Y.Z` updates every file (CONTRIBUTING.md → Releasing).

## Done means

Typecheck, lint and tests pass; the task's "Done" line and the milestone's acceptance criteria are met;
README updated if setup changed; a line under CHANGELOG.md [Unreleased] if people running Pantry will notice;
and the docs (apps/site/content/docs, served at /docs) updated in the same change when what people or agents do
changes: setup, settings, screens, MCP behaviour. The MCP tool reference, keyboard shortcuts and changelog pages are
generated from packages/mcp, packages/app/src/shortcuts.ts and CHANGELOG.md, so keep descriptions there accurate;
a new MCP tool also needs a group in apps/site/lib/docs/mcp.ts (`pnpm check` fails until it has one, and when a
docs page names a tool that no longer exists).
