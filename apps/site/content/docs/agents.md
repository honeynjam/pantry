Pantry has an MCP server built in, at `https://<your-app>/api/mcp`. Any agent that speaks MCP over HTTP can read
and update your issues. There are two ways to connect, and both act as you:

- **Sign in** (Claude on claude.ai, Desktop and mobile; ChatGPT; any client that supports MCP OAuth): paste the URL,
  sign in to Pantry in the browser window that opens and press **Allow**. No token to copy.
- **API token** (Claude Code, Cursor and other clients that let you set a header): create a token and paste a
  snippet.

## Connect Claude (claude.ai, Desktop, mobile)

1. In Claude, open **Customize → Connectors** and click **+ → Add custom connector**.
2. Name it "Pantry" and paste `https://<your-app>/api/mcp` as the URL. Leave the OAuth client fields empty.
3. Click **Connect**. A Pantry window opens: sign in if asked, check the app and where it sends you
   (`claude.ai`), and press **Allow**.

The connector then works in every Claude app you're signed in to. On Team and Enterprise plans an owner may have to
add the connector for the organisation first.

## Connect ChatGPT

1. In ChatGPT, open **Settings → Apps → Advanced settings** and turn on **Developer mode**.
2. Click **Create app**, name it "Pantry", paste `https://<your-app>/api/mcp` and choose **OAuth** as the
   authentication.
3. Click **Create**, sign in to Pantry if asked, and press **Allow**. In a chat, add Pantry from the **+** menu.

ChatGPT may ask you to confirm before it runs a tool that changes something.

## Connect Claude Code or Cursor (API token)

1. In the app, open **Settings → API tokens** (or the user menu → API tokens). Name the token after where it will
   live, like "Claude Code on my laptop", and create it. You see it once.
2. Paste the snippet the screen shows into your agent.

**Claude Code:**

```shell
claude mcp add --transport http pantry \
  https://<your-app>/api/mcp \
  --header "Authorization: Bearer <token>"
```

**Cursor** (`mcp.json`, with the token in the `PANTRY_TOKEN` environment variable):

```json
{
  "mcpServers": {
    "pantry": {
      "url": "https://<your-app>/api/mcp",
      "headers": { "Authorization": "Bearer ${env:PANTRY_TOKEN}" }
    }
  }
}
```

Other clients need the same two things: the URL and an `Authorization: Bearer <token>` header. A client that
supports MCP OAuth can skip the token and sign in instead.

## Work on an issue

Tell the agent "work on PAN-12". It calls `get_issue`, then `get_space_context` for the issue's space and follows
that doc. It moves the issue to In Progress with `update_issue` when it starts and to In Review when it's done,
posts notes with `add_comment` and files follow-ups with `create_sub_issue`. Nothing changes status by itself.

## Organise work

Agents can set things up too: "set up a space for Acme with Website and Launch projects and file these issues"
works. They call `get_workspace` first to see the spaces, projects, statuses, labels and people that exist. The
full list is in [MCP tools](/docs/mcp-tools).

## What agents can't do

The agent acts as you, inside your workspace only, and can do what a member can in the app, except:

- delete spaces, comments or labels, or archive spaces;
- add or remove statuses;
- manage invites, members or API tokens.

It can delete an issue only by repeating its key (`delete_issue` with `confirm`), and is told to ask you first.

## Tokens and connected apps

Everything an agent does shows under your name, tagged "via MCP". **Settings → API tokens** lists both your tokens
and your **Connected apps** (the ones you signed in to). Revoking a token or disconnecting an app stops it at once:
its next call gets a 401. Use one token per machine or agent, so you can revoke one without the others.

A connected app gets a token that lasts an hour and renews itself in the background for as long as you use it. If
it goes unused for 30 days it has to sign in again. When you remove someone from the workspace, their tokens and
connected apps stop working too.

Running more than one instance? Each is its own MCP server entry. Name them apart (`pantry-home`, `pantry-acme`)
and tell the agent which one to use.

### How signing in works

Pantry is its own OAuth authorization server for its MCP endpoint (the MCP authorization spec, 2026-07-28):

- `/api/mcp` answers `401` with `WWW-Authenticate: Bearer resource_metadata=…`, pointing at
  `/.well-known/oauth-protected-resource/api/mcp`. That names your instance as the issuer;
  `/.well-known/oauth-authorization-server` lists the endpoints under `/api/oauth/`.
- Apps identify themselves with a Client ID Metadata Document (Claude, ChatGPT) or register themselves (dynamic
  client registration). Either way they're public clients: PKCE (S256) and the exact redirect URI are required.
- The consent screen shows the app's name, the site it was verified from (or "name not verified" for a registered
  app) and where it will send you. Tokens are bound to `https://<your-app>/api/mcp` and stored only as hashes.

Your instance has to be reachable over public HTTPS for Claude and ChatGPT: they connect from their own servers,
not from your computer.
