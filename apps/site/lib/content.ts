import { brand } from "@pantry/backend/brand";

/**
 * Every word on the landing page. The product name, issue key and token prefix come from brand.ts,
 * so a rename stays a one-file change.
 */

const name = brand.name;
const key = brand.defaultKey;
export const issueKey = (n: number) => `${key}-${n}`;
export const brandName = name;

const repo = "https://github.com/honeynjam/pantry";

export const links = {
  repo,
  repoApi: "https://api.github.com/repos/honeynjam/pantry",
  readme: `${repo}#readme`,
  releases: `${repo}/releases`,
  licence: `${repo}/blob/main/LICENSE`,
  deploy:
    "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhoneynjam%2Fpantry&project-name=pantry&repository-name=pantry&root-directory=apps%2Fweb&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22convex%22%2C%22productSlug%22%3A%22convex%22%2C%22protocol%22%3A%22storage%22%7D%5D",
  deployGuide: "/docs/deploy",
  /** The live demo (spec §9f). Hidden until it exists. */
  demo: null as string | null,
};

export const nav = {
  product: {
    label: "Product",
    items: [
      {
        id: "agents",
        label: "Agents and MCP",
        body: "Agents read the brief and update issues as you.",
      },
      {
        id: "speed",
        label: "Keyboard first",
        body: "A shortcut for every action. Live on every screen.",
      },
      { id: "mac", label: "Mac app", body: "Quick-add from anywhere on your Mac.", badge: "Soon" },
      {
        id: "self-host",
        label: "Self-hosting",
        body: "Your own Vercel and Convex, in about five minutes.",
      },
    ],
  },
  links: [
    { label: "Docs", href: "/docs" },
    { label: "Changelog", href: "/docs/changelog" },
  ],
};

export const hero = {
  title: "The issue tracker for small teams and their agents.",
  lede: `${name} is a fast, keyboard-first tracker for one to three people. Point Claude Code or Cursor at an issue and it reads the brief, does the work and reports back.`,
  primary: "Deploy your own",
  primaryShort: "Deploy",
  secondary: "View on GitHub",
  runsOn: "Free and MIT licensed. Runs on your own",
  demo: "Try the live demo",
};

export const agents = {
  worksWith: "Works with any agent that speaks MCP",
  list: ["Claude", "Cursor", "Copilot", "Gemini", "Windsurf", "Zed", "Cline", "Warp"] as const,
  names: {
    Claude: "Claude Code",
    Cursor: "Cursor",
    Copilot: "GitHub Copilot",
    Gemini: "Gemini CLI",
    Windsurf: "Windsurf",
    Zed: "Zed",
    Cline: "Cline",
    Warp: "Warp",
  },
};

export const manifesto =
  "Most trackers are built for companies with forty teams. You have two people, a few products and a handful of agents doing real work. You don't need triage, sprints or story points. You need issues that open instantly, a shortcut for everything, and one place where your agents read the brief and report back.";

export const mcp = {
  id: "agents",
  title: `Tell your agent “work on ${issueKey(42)}”.`,
  lede: `Every ${name} instance runs its own MCP server. From an issue key, your agent gets the issue, its sub-issues, the comments and the space's context doc. Then it moves the status and writes up what it did, as you.`,
  points: [
    {
      title: "A brief agents read first",
      body: "Each space (a product or a client) has a markdown context doc: stack, conventions, what not to touch. Agents load it before they start.",
    },
    {
      title: "Shows as you, tagged “via MCP”",
      body: "Agents act with your personal token, so every change lands in the activity log under your name.",
    },
    {
      title: "Nothing moves by itself",
      body: "Statuses change only when you or your agent change them. No automations to untangle later.",
    },
  ],
  /** The count and names come from packages/mcp (see sections.tsx), so they can't drift. */
  toolsLabel: (count: number) => `${count} tools`,
  toolsBody:
    "Everything an agent needs to work an issue and organise a space. Deleting spaces and managing people stay in the app.",
  toolsLink: "See every tool",
  configTitle: "Connect in one line",
  configs: [
    {
      id: "claude",
      label: "Claude Code",
      code: `claude mcp add --transport http pantry \\\n  https://pantry.yourname.dev/api/mcp \\\n  --header "Authorization: Bearer ${brand.tokenPrefix}••••••••"`,
    },
    {
      id: "cursor",
      label: "Cursor",
      code: `{\n  "mcpServers": {\n    "pantry": {\n      "url": "https://pantry.yourname.dev/api/mcp",\n      "headers": {\n        "Authorization": "Bearer \${env:PANTRY_TOKEN}"\n      }\n    }\n  }\n}`,
    },
  ],
};

export const speed = {
  id: "speed",
  title: "A shortcut for everything.",
  lede: `${name} opens fast, updates the moment anything changes, and never makes you reach for the mouse.`,
  tabs: [
    {
      id: "palette",
      label: "Command palette",
      title: "⌘K, a few letters, Enter",
      body: "Jump to any issue, project or action. Exact keys rank first, so pan-42 is always one keystroke away.",
    },
    {
      id: "board",
      label: "List and board",
      title: "Same issues, two views",
      body: "Drag a card across columns, or press S and pick a status without leaving the keyboard.",
    },
    {
      id: "live",
      label: "Live updates",
      title: "No refresh, no spinner",
      body: "Convex keeps every screen in sync. Your partner sees the agent's comment the moment it lands.",
    },
  ],
  shortcuts: [
    { keys: "c", label: "New issue" },
    { keys: "j", label: "Next" },
    { keys: "k", label: "Previous" },
    { keys: "s", label: "Status" },
    { keys: "a", label: "Assignee" },
    { keys: "p", label: "Priority" },
    { keys: "g i", label: "My issues" },
  ],
};

export const mac = {
  id: "mac",
  badge: "Coming soon",
  title: "Capture an issue from anywhere on your Mac.",
  lede: "A global shortcut opens quick-add over whatever you're doing. A menu bar item and native notifications keep you in the loop. Built with Tauri, so it opens instantly and stays light.",
  points: [
    { keys: "mod+shift+i", label: "Quick-add from any app" },
    { keys: "mod+k", label: "Command palette" },
    { keys: "[", label: "Fold the sidebar" },
  ],
};

export const selfHost = {
  id: "self-host",
  title: "Runs on your own Vercel and Convex.",
  lede: `Click Deploy, connect Convex, open your URL. About five minutes later you have your own ${name}. You own the code, the data and the accounts.`,
  steps: [
    { title: "Deploy", body: "Vercel copies the repo into your GitHub and builds it." },
    {
      title: "Connect Convex",
      body: "One click adds the database. Secrets are generated for you.",
    },
    { title: "Invite your partner", body: "Create an invite link and send it yourself." },
  ],
  facts: [
    { logo: "github", title: "MIT licensed", body: "Read it, fork it, change it." },
    { logo: "convex", title: "Your data", body: "Issues live in your Convex project." },
    { logo: "vercel", title: "Free tiers fit", body: "Hobby and Free plans cover a small team." },
    { logo: "pr", title: "Updates as PRs", body: "A weekly pull request. Merge when you like." },
  ] as const,
  footnote: "Vercel Hobby is for non-commercial use. Use a Pro plan for paid work.",
};

export const leftOut = {
  title: "We started from Linear and cut.",
  lede: "Everything a team of two never opens, gone for good.",
  items: [
    "Teams and sub-teams",
    "Triage inboxes",
    "Story points",
    "Insights dashboards",
    "Initiatives",
    "Guest permissions",
    "Time tracking",
    "SAML and audit logs",
  ],
};

export const finalCta = {
  title: `Start at ${issueKey(1)}.`,
  lede: `Your own ${name} in about five minutes. Free, open source and yours.`,
};

export const footer = {
  tagline: "An issue tracker for small teams and their agents.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Agents and MCP", href: "/#agents" },
        { label: "Keyboard first", href: "/#speed" },
        { label: "Mac app", href: "/#mac" },
        { label: "Self-hosting", href: "/#self-host" },
      ],
    },
    {
      title: "Open source",
      links: [
        { label: "GitHub", href: repo },
        { label: "Docs", href: "/docs" },
        { label: "Setup guide", href: "/docs/deploy" },
        { label: "Changelog", href: "/docs/changelog" },
        { label: "MIT licence", href: `${repo}/blob/main/LICENSE` },
      ],
    },
  ],
  legal: "MIT licensed. Not affiliated with the products shown.",
};
