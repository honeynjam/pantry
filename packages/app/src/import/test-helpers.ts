import { readFileSync } from "node:fs";
import {
  defaultOptions,
  planImport,
  summarize,
  type ImportContext,
  type ReviewOptions,
  type WorkspaceInfo,
} from "./engine";
import type { Adapter, SourceFile } from "./source";

/**
 * Shared by the adapter tests (not shipped: only *.test.ts import it). Fixtures are synthetic, with the
 * column layouts of real exports; never real people or companies.
 */

export const fixture = (name: string): SourceFile => ({
  name,
  text: readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
});

export const workspace: WorkspaceInfo = {
  statuses: [
    { _id: "s-backlog", name: "Backlog", category: "backlog" },
    { _id: "s-todo", name: "Todo", category: "unstarted" },
    { _id: "s-progress", name: "In Progress", category: "started" },
    { _id: "s-review", name: "In Review", category: "review" },
    { _id: "s-done", name: "Done", category: "done" },
    { _id: "s-canceled", name: "Canceled", category: "canceled" },
  ],
  spaces: [{ _id: "space-pan", key: "PAN", name: "Pantry" }],
  labels: [{ name: "Bug" }],
  projects: [],
  members: [
    { _id: "m-kris", displayName: "Kris" },
    { _id: "m-ana", displayName: "Ana Moreno" },
  ],
};

export const emptyContext: ImportContext = {
  teams: {},
  people: { "kris@example.com": { memberId: "m-kris", displayName: "Kris" } },
  imported: {},
};

/** Parse → summary → default options (with `patch`) → plan, like the review does. */
export function run(
  adapter: Adapter,
  files: SourceFile[],
  {
    toggles = {},
    context = emptyContext,
    patch = {},
  }: {
    toggles?: Record<string, boolean>;
    context?: ImportContext;
    patch?: Partial<ReviewOptions>;
  } = {},
) {
  const defaults = adapter.defaultSettings(files);
  const parsed = adapter.parse(files, { ...defaults, toggles: { ...defaults.toggles, ...toggles } });
  const summary = summarize(parsed, adapter.foldFields);
  const options = {
    ...defaultOptions(parsed, summary, workspace, context, adapter.keyFallback),
    ...patch,
  };
  const plan = planImport(parsed, summary, options, workspace, context, adapter.noteName);
  const draft = (key: string) => {
    const found = plan.drafts.find(
      (row) => row.sourceKey === key || row.externalId === key || row.externalId.endsWith(`:${key}`),
    );
    if (!found) throw new Error(`No draft for ${key}`);
    return found;
  };
  return { parsed, summary, options, plan, draft };
}

/** What a second import sees after the first one brought everything in. */
export function importedAll(plan: { drafts: { externalId: string }[] }): ImportContext {
  return {
    ...emptyContext,
    imported: Object.fromEntries(plan.drafts.map((row, index) => [row.externalId, `X-${index + 1}`])),
  };
}
