Pantry has an MCP server built in, at `https://<your-app>/api/mcp`. Any agent that speaks MCP over HTTP (Claude
Code, Cursor and others) can read and update your issues with a personal API token.

## Connect

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

Other clients need the same two things: the URL and an `Authorization: Bearer <token>` header.

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

## Tokens

Everything an agent does shows under the token owner's name, tagged "via MCP". Revoking a token on the API tokens
screen stops it at once: its next call gets a 401. Use one token per machine or agent, so you can revoke one
without the others.

Running more than one instance? Each is its own MCP server entry with its own token. Name them apart
(`pantry-home`, `pantry-acme`) and tell the agent which one to use.
