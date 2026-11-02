import { readFile } from "node:fs/promises";
import path from "node:path";

/** apps/site, both under `next build` and vitest (each runs from the package directory). */
const siteRoot = process.cwd();
export const contentDir = path.join(siteRoot, "content/docs");
export const repoRoot = path.join(siteRoot, "../..");

export const contentFile = (slug: string) => path.join(contentDir, `${slug || "index"}.md`);

export function readDocMarkdown(slug: string): Promise<string> {
  return readFile(contentFile(slug), "utf8");
}

/** CHANGELOG.md without its title (the page has one); the release headings link to GitHub. */
export async function readChangelog(): Promise<string> {
  const markdown = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  return markdown.replace(/^# Changelog\s*\n/, "");
}
