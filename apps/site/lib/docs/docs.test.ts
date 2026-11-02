import { readdir, readFile } from "node:fs/promises";
import { helpSections } from "@pantry/app/shortcuts";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { TOOL_GROUPS, TOOL_NAMES, toolDocs } from "./mcp";
import { DOC_PAGES, docHref } from "./nav";
import { contentDir, readChangelog, readDocMarkdown } from "./source";

/**
 * Keeps the docs honest as the code changes. If one of these fails after your change, update the
 * docs in apps/site/content/docs (or lib/docs/mcp.ts for a new tool) in the same PR.
 */

const markdownPages = DOC_PAGES.filter((page) => !page.generated);
const docPaths = new Set(DOC_PAGES.map((page) => docHref(page.slug)));

describe("docs pages", () => {
  it("every markdown page in the nav has a file, and every file is in the nav", async () => {
    const files = (await readdir(contentDir)).filter((file) => file.endsWith(".md")).sort();
    const expected = markdownPages.map((page) => `${page.slug || "index"}.md`).sort();
    expect(files).toEqual(expected);
  });

  it("every /docs link points at a page that exists", async () => {
    const sources = [...(await Promise.all(markdownPages.map((page) => readDocMarkdown(page.slug)))), await readChangelog()];
    for (const markdown of sources) {
      const { html } = await renderMarkdown(markdown, { highlight: false });
      for (const [, href] of html.matchAll(/href="(\/docs[^"#]*)/g)) {
        expect(docPaths, `broken docs link ${href}`).toContain(href!.replace(/\/$/, ""));
      }
    }
  });
});

describe("MCP tools", () => {
  it("every tool is in exactly one group on the MCP tools page", () => {
    const grouped = TOOL_GROUPS.flatMap((group) => group.tools);
    const missing = TOOL_NAMES.filter((name) => !grouped.includes(name));
    expect(missing, `add these tools to TOOL_GROUPS in apps/site/lib/docs/mcp.ts and mention them in the docs`).toEqual([]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.filter((name) => !TOOL_NAMES.includes(name)), "these grouped tools no longer exist").toEqual([]);
  });

  it("docs only mention tools that exist", async () => {
    const toolLike = /`((?:get|list|search|create|update|add|delete|archive|unarchive|reorder)_[a-z_]+)`/g;
    for (const page of markdownPages) {
      const markdown = await readDocMarkdown(page.slug);
      for (const [, name] of markdown.matchAll(toolLike)) {
        expect(TOOL_NAMES, `${page.slug || "index"}.md mentions \`${name}\``).toContain(name);
      }
    }
  });

  it("every tool and parameter has a description to show", () => {
    for (const doc of toolDocs()) {
      expect(doc.description, doc.name).not.toBe("");
      for (const param of doc.params) expect(param.description, `${doc.name}.${param.name}`).not.toBe("");
    }
  });
});

describe("generated pages", () => {
  it("the shortcuts page has shortcuts to show", () => {
    expect(helpSections().flatMap((section) => section.rows).length).toBeGreaterThan(10);
  });

  it("the changelog has an Unreleased section and releases", async () => {
    const changelog = await readFile(new URL("../../../../CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toMatch(/^## \[Unreleased\]/m);
  });
});
