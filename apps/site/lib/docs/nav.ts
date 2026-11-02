/**
 * Every docs page, in sidebar order. A page is either a markdown file in content/docs/<slug>.md
 * (`index.md` for the introduction) or `generated`: rendered from the code itself (the MCP tools,
 * the shortcut registry, CHANGELOG.md), so it can't drift. docs.test.ts checks this list against
 * the files and every /docs link.
 */
export type DocPage = {
  slug: string;
  title: string;
  description: string;
  generated?: "mcp-tools" | "keyboard-shortcuts" | "changelog";
};

export type DocSection = { title: string; pages: DocPage[] };

export const DOCS_NAV: DocSection[] = [
  {
    title: "Getting started",
    pages: [
      {
        slug: "",
        title: "Introduction",
        description: "What Pantry is, who it's for and how the pieces fit together.",
      },
      {
        slug: "deploy",
        title: "Deploy your own",
        description: "Your own Pantry on Vercel and Convex in about five minutes.",
      },
      {
        slug: "onboarding",
        title: "Onboarding and invites",
        description: "Set up your workspace, then bring in the people you work with.",
      },
      {
        slug: "updating",
        title: "Updating your instance",
        description: "Get new releases as pull requests and merge them when you're ready.",
      },
      {
        slug: "troubleshooting",
        title: "Troubleshooting",
        description: "Fixes for the problems people hit while deploying and connecting agents.",
      },
    ],
  },
  {
    title: "Using Pantry",
    pages: [
      {
        slug: "spaces",
        title: "Spaces and projects",
        description: "How work is organised: workspace, spaces, projects and issues.",
      },
      {
        slug: "issues",
        title: "Issues",
        description: "Statuses, priorities, labels, sub-issues, views and filters.",
      },
      {
        slug: "keyboard-shortcuts",
        title: "Keyboard shortcuts",
        description: "Every shortcut in the app, straight from its shortcut registry.",
        generated: "keyboard-shortcuts",
      },
    ],
  },
  {
    title: "Agents",
    pages: [
      {
        slug: "agents",
        title: "Connect an agent",
        description: "Give Claude Code, Cursor or any MCP client access to your issues.",
      },
      {
        slug: "context-docs",
        title: "Writing context docs",
        description: "The brief every agent reads before it starts work in a space.",
      },
      {
        slug: "mcp-tools",
        title: "MCP tools",
        description: "Every tool the MCP server offers, with its parameters.",
        generated: "mcp-tools",
      },
    ],
  },
  {
    title: "Project",
    pages: [
      {
        slug: "development",
        title: "Local development",
        description: "Run Pantry on your machine, with no Convex account.",
      },
      {
        slug: "changelog",
        title: "Changelog",
        description: "What changed in each release.",
        generated: "changelog",
      },
    ],
  },
];

export const DOC_PAGES: DocPage[] = DOCS_NAV.flatMap((section) => section.pages);

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs");

export function findDoc(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

/** The pages before and after, for the links at the bottom of each page. */
export function neighbours(slug: string): { previous?: DocPage; next?: DocPage } {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  return { previous: DOC_PAGES[index - 1], next: DOC_PAGES[index + 1] };
}
