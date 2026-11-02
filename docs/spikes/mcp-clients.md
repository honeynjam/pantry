# MCP clients: the M4 real-client run (task 5)

**For Kris.** This is the M4 acceptance run against your instance, https://pantry-teal-kappa.vercel.app, with
Claude Code first and then Cursor. Everything here needs your accounts, so nothing below has been run against
your instance yet. Fill in the results table at the end; that table is the record for task 5.

The same script already passed locally (26 Oct 2026). That run used a production build, a local Convex backend,
a token created in the UI, and both the MCP client SDK and a real headless Claude Code run. Details are in
`docs/M4-NOTES.md`.

## 0. Deploy M4 to your instance

M4 is on branch `m4/mcp`. It has no schema change: `apiTokens` was already in the schema, and no new tables or
fields were added. It runs on the Spaces release's transitional schema, so `migrations:run` has nothing to do.

1. Merge `m4/mcp` into `main`, then push to your instance repo the way you normally do. Vercel's build deploys
   Convex and the web app together.
2. Check the endpoint is live and refuses calls without a token:

   ```bash
   curl -s -i -X POST https://pantry-teal-kappa.vercel.app/api/mcp \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -5
   ```

   Expect `HTTP/2 401` and a `www-authenticate: Bearer error="invalid_token"` header. A `503` means the build
   didn't get `NEXT_PUBLIC_CONVEX_URL` (README troubleshooting). A `404` means the deploy doesn't include M4 yet.

## 1. Create a token

1. Open **Settings → API tokens** (it's also in the user menu and the ⌘K palette as "API tokens").
2. Name the token "Claude Code on <machine>" and click **Create token**. Copy the token now: it's shown only once.
3. The **Claude Code** tab now shows the full command with your token already in it.

## 2. Claude Code

1. Run the command from the screen. It looks like this:

   ```bash
   claude mcp add --transport http pantry https://pantry-teal-kappa.vercel.app/api/mcp \
     --header "Authorization: Bearer pan_…"
   ```

   It's added with **local** scope by default, so it works only in the folder you ran it in. Add `--scope user`
   to use Pantry in every project. Don't use `--scope project`: that writes the token into a `.mcp.json` file
   you might commit.
2. Run `claude mcp list` and check that `pantry` shows **✓ Connected**. Inside a session, `/mcp` lists its 16
   tools (see "What agents can do" below).
3. Pick a real issue in Todo, say `PAN-N`. (Fill in PAN's context doc first if it's still the template; the agent
   reads it.) Start `claude` in the repo and say:

   > Work on PAN-N. Read the issue and its space's context doc, move it to In Progress, add a comment with your
   > plan, add a sub-issue for the follow-up you'd split out, and when you're done move PAN-N to In Review.

   Approve the Pantry tool calls when Claude Code asks.
4. Open PAN-N in the browser. In the activity list, each step should show **under your name, tagged "via MCP"**:
   - changed status from Todo to In Progress (via MCP)
   - your plan as a comment (via MCP)
   - the new sub-issue in **Sub-issues**; opening it shows "created the issue" (via MCP), with the same space and
     project as PAN-N
   - changed status from In Progress to In Review (via MCP)

   Reading the issue and the context doc leaves no trace in the app; check Claude Code's transcript for those two
   calls. Changes made in the app, like creating the issue yourself, don't get the tag.
5. Back in **Settings → API tokens**, the token should say "Used just now". The time updates at most once every
   10 minutes.

## 3. Cursor

1. Create a second token, "Cursor on <machine>", and switch to the **Cursor** tab.
2. Add the `mcp.json` snippet to `~/.cursor/mcp.json` (all projects) or to `.cursor/mcp.json` in one project:

   ```json
   {
     "mcpServers": {
       "pantry": {
         "url": "https://pantry-teal-kappa.vercel.app/api/mcp",
         "headers": { "Authorization": "Bearer ${env:PANTRY_TOKEN}" }
       }
     }
   }
   ```

3. Make `PANTRY_TOKEN` visible to Cursor. **macOS apps opened from the Dock don't read `~/.zshrc`**, so do one of
   these:
   - start Cursor from a terminal that has it: `export PANTRY_TOKEN=pan_…` then `cursor .`;
   - or run `launchctl setenv PANTRY_TOKEN pan_…` and restart Cursor (this lasts until you log out).
4. Open Cursor Settings → MCP (Tools & Integrations). `pantry` should be green with 16 tools. If it's red and
   the log shows 401, the variable didn't reach Cursor.
5. In Agent chat, run the same script on a different issue, then check the browser the same way as in step 2.4.

Not verified by me: Cursor itself, and its `${env:…}` interpolation in `headers` (taken from Cursor's docs, as
checked in the spec on 26 Oct 2026).

## 4. Revoke check

1. In **Settings → API tokens**, revoke the Cursor token and confirm.
2. In Cursor, ask the agent to call any Pantry tool. It should fail, and Cursor's MCP log should show a 401.
   Another way to check, from a terminal:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://pantry-teal-kappa.vercel.app/api/mcp \
     -H "authorization: Bearer $PANTRY_TOKEN" -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   This should print `401`. The response body says "No authorization provided" even for a revoked token: that's
   mcp-handler's wording, not a sign that the header is missing.
3. Keep the Claude Code token if you're going to keep using it.

## What agents can do

Everything a member can do in the app, as you and tagged "via MCP", except the things listed last.

- **Find their way:** `get_workspace` (spaces, projects, statuses, labels, people), `get_space_context`,
  `list_issues` (filters), `search_issues` (key or title words).
- **Work an issue:** `get_issue`, `update_issue` (status, title, description, priority, assignee, labels,
  project, due date), `add_comment`, `create_sub_issue`, `create_issue`.
- **Organise:** `create_space` and `update_space` (name, kind; the key is fixed), `update_space_context`,
  `create_project`, `update_project` (rename, recolour), `archive_project` (its issues stay in the space) and
  `unarchive_project` (the project comes back; its old issues don't), `create_label`, `update_status` (rename or
  recolour a status for everyone) and `reorder_statuses`.
- **Delete an issue:** `delete_issue { key, confirm }` deletes it with its sub-issues and comments, only when
  `confirm` repeats the key. Agents are told to ask you first unless you asked for the delete.
- **Not over MCP:** deleting spaces, comments or labels; archiving spaces; adding or removing statuses; invites,
  members and API tokens. Agents are told to ask you.

Optional extra check for the organising tools (any client): "Set up a space ACME for client work with projects
Website and Launch, write its context doc, file three issues across them with labels and due dates, then archive
Launch." Afterwards ACME's settings show the projects and doc, and each issue's activity says "via MCP". Archive
or rename the space in the app afterwards if you don't want to keep it.

## 5. Claude app and ChatGPT: URL-only, sign in over OAuth (0.1.30)

Claude (claude.ai, Desktop, mobile) and ChatGPT can't send an `Authorization` header, so Pantry is its own OAuth
server for `/api/mcp` (MCP authorization spec 2026-07-28; design notes at the top of
`packages/backend/convex/lib/oauth.ts`). Real Claude and ChatGPT connect from their servers, so this needs the
deployed instance; localhost was covered by an end-to-end run with the MCP client SDK (branch `feat/mcp-oauth`).

**What they use.** Both identify themselves with a Client ID Metadata Document when the server advertises
`client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported` (Pantry does), and
fall back to dynamic registration otherwise. Redirects: Claude `https://claude.ai/api/mcp/auth_callback`; ChatGPT
`https://chatgpt.com/connector_platform_oauth_redirect` (it uses this stable one only when the server returns `iss`
in the authorization response, which Pantry does). ChatGPT developer mode no longer needs `search`/`fetch` tools.

0. After deploying, check discovery (all three should be JSON; the 401 should name the second URL):

   ```bash
   curl -s https://<instance>/.well-known/oauth-authorization-server
   curl -s https://<instance>/.well-known/oauth-protected-resource/api/mcp
   curl -s -i -X POST https://<instance>/api/mcp -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     | grep -i www-authenticate
   ```

1. **Claude.** claude.ai → **Customize → Connectors** → **+** → **Add custom connector**. Name "Pantry", URL
   `https://<instance>/api/mcp`, leave the advanced OAuth fields empty → **Add**. Click **Connect** on it. A Pantry
   window opens: sign in if asked. The consent screen should say **Connect Claude?** with a verified host (a badge
   and `claude.ai`) and "Sends you to `claude.ai`". Press **Allow**; the window closes and the connector shows as
   connected. In a new chat: "Use Pantry: what's in my workspace?" (`get_workspace`), then "Create an issue in PAN
   called 'Hello from Claude'". Check the app: the issue's activity says "via MCP" under your name.
2. **Claude Desktop.** Nothing to add: connectors sync from claude.ai. Open Desktop, check Pantry is listed under
   the connectors in a chat's tools menu, and ask it to list your issues.
3. **ChatGPT.** Settings → **Apps** → **Advanced settings** → turn on **Developer mode**. Then **Create app**: name
   "Pantry", MCP server URL `https://<instance>/api/mcp`, Authentication **OAuth** → **Create**. Sign in and
   **Allow** (consent should say "Sends you to `chatgpt.com`"). In a chat, **+** → Pantry, then ask "What's in my
   Pantry workspace?" and "Create an issue in PAN called 'Hello from ChatGPT'" (it asks you to confirm the write).
4. In Pantry, **Settings → API tokens → Connected apps** lists Claude and ChatGPT with "Used just now".
5. **Disconnect** Claude there, then ask Claude to list issues again: it should fail or ask you to reconnect.
   Reconnect from Customize → Connectors to confirm that works too.
6. Optional: leave a connector unused for over an hour, then use it. It should still work (the refresh token is
   used in the background; "Used …" updates).

If Claude shows the connector's sign-in but the Pantry window says "Can't connect this app", the message names the
problem (an unregistered redirect, or the metadata document couldn't be fetched). Send it over with the time.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `claude mcp list` shows ✗ / "Failed to connect" | Wrong URL (it must end in `/api/mcp`) or the deploy doesn't include M4. Try the curl in step 0. |
| 401 with a fresh token | The header lost its `Bearer ` prefix, or the token was copied cut short (it's `pan_` plus 43 characters). |
| Claude Code says the server needs authentication | It got a 401 and is offering to sign in over OAuth (supported since 0.1.30). Either fix the token in the header, or remove the header and let it sign in (`/mcp` → Authenticate). |
| Claude or ChatGPT: "Couldn't reach the MCP server" / "Authorization failed" | Open `https://<instance>/.well-known/oauth-authorization-server` in a browser: it must be JSON with `"issuer": "https://<instance>"`. The URL in the connector must end in `/api/mcp`. Section 5 has the full click-path. |
| A tool answers with an error listing names | Expected: an unknown status, project, label or person. The message lists the valid values and the agent retries. |
| "This workspace is finishing an upgrade" | `migrations:run` hasn't finished after a deploy; wait a minute. |

## Results (fill in)

| Check | Claude Code | Cursor |
|---|---|---|
| Server connects, 16 tools listed | | |
| Reads the issue (`get_issue`) | | |
| Reads the context doc (`get_space_context`) | | |
| Moves it to In Progress, shown "via MCP" under your name | | |
| Comment shown "via MCP" under your name | | |
| Sub-issue created, same space and project, "via MCP" | | |
| Moves it to In Review, shown "via MCP" | | |
| Token shows "Used …" | | |
| Revoked token → 401 on the next call | | |

| OAuth check (section 5) | Claude (claude.ai) | Claude Desktop | ChatGPT |
|---|---|---|---|
| Connects with only the URL; consent shows the verified host | | | |
| `get_workspace` works | | | |
| Issue created, shown "via MCP" under your name | | | |
| Listed under Connected apps, "Used …" | | | |
| Still works after an hour (refresh) | | | |
| Disconnect → stops working; reconnect works | | | |

Notes (client versions, anything odd):
