import rehypeShiki from "@shikijs/rehype";
import type { Element, Root } from "hast";
import { toString } from "hast-util-to-string";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { links } from "@/lib/content";

export type TocItem = { id: string; text: string; depth: 2 | 3 };

/**
 * Links written for GitHub (README sections, repo files) point at their docs page when one exists,
 * and at the file on GitHub otherwise, so the changelog and docs can share wording with the repo.
 */
const README_SECTIONS: Record<string, string> = {
  "deploy-your-own-about-5-minutes": "/docs/deploy",
  "connect-your-agents-mcp": "/docs/agents",
  troubleshooting: "/docs/troubleshooting",
  "updating-your-instance": "/docs/updating",
  "automatic-updates-opt-in": "/docs/updating#automatic-updates-opt-in",
  "when-an-update-doesnt-deploy": "/docs/updating#when-an-update-doesnt-deploy",
  "develop-locally": "/docs/development",
};

export function rewriteHref(href: string): string {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href;
  const [file = "", hash = ""] = href.split("#");
  if (/^(\.\/)?README\.md$/.test(file) && README_SECTIONS[hash]) return README_SECTIONS[hash]!;
  return `${links.repo}/blob/main/${file.replace(/^\.\//, "")}${hash ? `#${hash}` : ""}`;
}

/** Collects h2/h3 for "On this page" and makes each heading a link to itself. */
function rehypeHeadings(toc: TocItem[]) {
  return () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "a" && typeof node.properties.href === "string") {
        node.properties.href = rewriteHref(node.properties.href);
        return;
      }
      if (node.tagName !== "h2" && node.tagName !== "h3") return;
      const id = String(node.properties.id ?? "");
      if (!id) return;
      toc.push({ id, text: toString(node), depth: node.tagName === "h2" ? 2 : 3 });
      node.children = [
        { type: "element", tagName: "a", properties: { href: `#${id}`, className: ["heading-anchor"] }, children: node.children },
      ];
    });
  };
}

/**
 * Markdown (GitHub-flavoured) → HTML with highlighted code and an outline. `highlight: false` skips
 * Shiki, the slow part, for callers that only need the links and headings.
 */
export async function renderMarkdown(
  markdown: string,
  { highlight = true }: { highlight?: boolean } = {},
): Promise<{ html: string; toc: TocItem[] }> {
  const toc: TocItem[] = [];
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSlug).use(rehypeHeadings(toc));
  if (highlight) {
    processor.use(rehypeShiki, { theme: "github-light", lazy: true, fallbackLanguage: "text", defaultLanguage: "text" });
  }
  const file = await processor.use(rehypeStringify).process(markdown);
  return { html: String(file), toc };
}
