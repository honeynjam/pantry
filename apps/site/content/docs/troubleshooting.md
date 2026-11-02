Start with the health check: `GET https://<your-app>/api/instance` returns `{ name, convexUrl, convexSiteUrl,
serverVersion, minAppVersion, needsSecret }`.

| Symptom | Fix |
| --- | --- |
| Build log: `CONVEX_DEPLOY_KEY is not set` | Connect the Convex integration to the project for Production and Preview, with no Custom Prefix, then redeploy. |
| Build fails with "Pantry must be built from apps/web", "No Output Directory named public", "No Next.js version detected" or can't find `scripts/vercel-build.sh` | Root Directory isn't `apps/web`. Project → Settings → Build and Deployment → Root Directory → `apps/web`, then redeploy. |
| The app is blank or says "This app has no Convex address" | The Convex URL wasn't injected: the build command must be `bash ../../scripts/vercel-build.sh`, which `apps/web/vercel.json` sets. Don't override it in Vercel. |
| Sign-in fails with an origin or URL error | Convex `SITE_URL` must match the URL you opened. Use the production URL, not a deployment-specific one. After adding a domain, redeploy. |
| Setup screen: "One more step" | Set `BETTER_AUTH_SECRET` once (the screen shows the command). `/api/instance` shows `"needsSecret": false` when it's fixed. |
| Vercel can't connect the repo | Hobby can't use repos owned by a GitHub organisation. Clone into a personal account. |
| An MCP client says 401 or unauthorized | The token was revoked or mistyped. Create a new one in Settings → API tokens and update the client's header. |
| You hit a Convex free-plan limit | Convex dashboard → Usage. A runaway agent loop is the usual cause: revoke its token. |

Still stuck? [Open an issue](https://github.com/honeynjam/pantry/issues) with what you see in the build log or on
`/api/instance`.
