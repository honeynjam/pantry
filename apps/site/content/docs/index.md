Pantry is a fast, keyboard-first issue tracker for one to three people who build with AI coding agents. It's
open source (MIT), and it runs on your own Vercel and Convex accounts: there's no hosted plan, and your data
never touches ours.

## How it fits together

- **Your instance** is a copy of the Pantry repo in your GitHub account, deployed by Vercel, with its data in your
  own Convex project. One click sets it up; see [Deploy your own](/docs/deploy).
- **A workspace** is everything on that instance: its people, spaces and issues. The first account created becomes
  the owner, and everyone else joins by invite.
- **Spaces** are your products or clients. Each has its own issue key (`PAN-42`), its issues and a context doc for
  agents. **Projects** are optional workstreams inside a space. See [Spaces and projects](/docs/spaces).
- **Agents** connect over MCP with a personal token. They read an issue and its space's context doc, do the work,
  move the issue and comment, all under your name and tagged "via MCP". See [Connect an agent](/docs/agents).

## What it leaves out

Pantry started from Linear and removed what a small team never opens: teams and sub-teams, triage inboxes, story
points, insights dashboards, initiatives, guest permissions, time tracking, SAML and audit logs. They're not on the
roadmap.

## Where to start

1. [Deploy your own](/docs/deploy) instance (about five minutes).
2. Walk through [onboarding](/docs/onboarding) and invite the people you work with.
3. [Connect your agent](/docs/agents) and tell it to work on an issue.
