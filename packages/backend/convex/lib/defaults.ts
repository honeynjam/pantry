import type { Infer } from "convex/values";
import type { category } from "../schema";
import { brand } from "./brand";

export type StatusCategory = Infer<typeof category>;

/**
 * The six default statuses, one per category (spec §3). Rename, recolour and reorder only in v0.1.
 * Colours are stored per status so users can recolour them; these hex values are the sRGB
 * versions of the status tokens in packages/ui (globals.css, --status-*).
 */
export const DEFAULT_STATUSES: ReadonlyArray<{
  name: string;
  category: StatusCategory;
  color: string;
}> = [
  { name: "Backlog", category: "backlog", color: "#84868c" },
  { name: "Todo", category: "unstarted", color: "#9b9ea6" },
  { name: "In Progress", category: "started", color: "#e5ae00" },
  { name: "In Review", category: "review", color: "#9172ee" },
  { name: "Done", category: "done", color: "#29ac68" },
  { name: "Canceled", category: "canceled", color: "#787a80" },
];

export const SAMPLE_SPACE = {
  name: brand.name,
  key: brand.defaultKey,
};

/** The starter context doc's placeholder sentence; onboarding replaces it with a one-line summary. */
export const CONTEXT_DOC_PLACEHOLDER = "One or two sentences on what you're building and for whom.";

export const SAMPLE_CONTEXT_DOC = `# Space context

Agents read this before they start work on an issue in this space (MCP \`get_space_context\`).
Keep it short and current.

## What this space is

${CONTEXT_DOC_PLACEHOLDER}

## How to work here

- Repo and branch conventions
- How to run, test and lint
- Definition of done for an issue

## Things to know

Constraints, gotchas and decisions an agent shouldn't relitigate.
`;

/** "Kris's workspace" → "kriss-workspace". Falls back to "workspace" when nothing is left. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "workspace";
}
