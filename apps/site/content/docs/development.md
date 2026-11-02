You need Node 24 (`nvm use`) and pnpm 10 (`corepack enable` or `npm i -g pnpm@10`). No Convex account is needed:
`pnpm dev` runs a local Convex backend.

```shell
pnpm i
pnpm dev   # local Convex backend (no login) + web on http://localhost:3000
```

The first time, give the local Convex deployment its two auth settings:

```shell
cd packages/backend
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

Then open http://localhost:3000. The setup screen creates your account and workspace.

## Checks

```shell
pnpm check   # what CI runs: format check, typecheck, lint, tests, web build
pnpm fix     # format and auto-fix lint
```

## Good to know

- `pnpm dev` runs Convex with `CONVEX_AGENT_MODE=anonymous` on 127.0.0.1:3210/3211. Set `CONVEX_AGENT_MODE=`
  (empty) to use your own Convex dev deployment instead. If those ports are taken, run it on others from
  `packages/backend`: `CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3260 --local-site-port 3261`.
- Data migrations run by themselves when `pnpm dev` starts and on every deploy. To run them by hand:
  `pnpm --filter @pantry/backend migrate`.
- The design system's review page is at http://localhost:3000/design while `pnpm dev` runs.
- This site, docs included, is `apps/site` on http://localhost:3002.

## Repo layout

| Path | What |
| --- | --- |
| `apps/web` | The web app on Vercel, and the `/api/mcp` endpoint |
| `apps/site` | This website and its docs |
| `apps/desktop` | The Mac app (Tauri), coming in a later release |
| `packages/backend` | Convex functions, schema and auth. All business logic lives here |
| `packages/app` | The app's screens, shared by web and the Mac app |
| `packages/ui` | Design system: tokens, components and motion |
| `packages/mcp` | The MCP tools |

Before you open a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md).
