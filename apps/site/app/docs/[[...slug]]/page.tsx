import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { McpToolsReference, mcpToolsToc } from "@/components/docs/mcp-tools-reference";
import { ShortcutsReference, shortcutsToc } from "@/components/docs/shortcuts-reference";
import { Toc } from "@/components/docs/toc";
import { links } from "@/lib/content";
import { renderMarkdown, type TocItem } from "@/lib/docs/markdown";
import { DOC_PAGES, DOCS_NAV, docHref, findDoc, neighbours, type DocPage } from "@/lib/docs/nav";
import { readChangelog, readDocMarkdown } from "@/lib/docs/source";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug ? page.slug.split("/") : [] }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findDoc((await params).slug?.join("/") ?? "");
  if (!page) return {};
  const title = page.slug ? `${page.title} · Pantry docs` : "Pantry docs";
  return { title, description: page.description, alternates: { canonical: docHref(page.slug) } };
}

/** Where to fix a page: its markdown file, or the code a generated page is read from. */
function sourceUrl(page: DocPage): string {
  const blob = `${links.repo}/blob/main`;
  if (page.generated === "mcp-tools") return `${blob}/packages/mcp/src/tools.ts`;
  if (page.generated === "keyboard-shortcuts") return `${blob}/packages/app/src/shortcuts.ts`;
  if (page.generated === "changelog") return `${blob}/CHANGELOG.md`;
  return `${links.repo}/edit/main/apps/site/content/docs/${page.slug || "index"}.md`;
}

async function body(page: DocPage): Promise<{ content: React.ReactNode; toc: TocItem[] }> {
  if (page.generated === "mcp-tools") return { content: <McpToolsReference />, toc: mcpToolsToc() };
  if (page.generated === "keyboard-shortcuts") return { content: <ShortcutsReference />, toc: shortcutsToc() };
  const markdown = page.generated === "changelog" ? await readChangelog() : await readDocMarkdown(page.slug);
  const { html, toc } = await renderMarkdown(markdown);
  return { content: <div className="docs-prose" dangerouslySetInnerHTML={{ __html: html }} />, toc };
}

export default async function DocPageView({ params }: Props) {
  const page = findDoc((await params).slug?.join("/") ?? "");
  if (!page) notFound();
  const section = DOCS_NAV.find((entry) => entry.pages.includes(page));
  const { content, toc } = await body(page);
  const { previous, next } = neighbours(page.slug);

  return (
    <div className="gap-12 py-10 sm:py-14 xl:grid xl:grid-cols-[minmax(0,1fr)_12rem]">
      <article className="min-w-0 max-w-3xl">
        <p className="text-sm text-muted-foreground">{section?.title}</p>
        <h1 className="mt-2 text-headline font-medium">{page.title}</h1>
        <p className="mt-4 text-lede text-muted-foreground">{page.description}</p>
        <div className="mt-10">{content}</div>

        <div className="mt-16 border-t border-border pt-6">
          <a
            href={sourceUrl(page)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="size-3.5" />
            {page.generated ? "This page is generated from the code. See the source" : "Edit this page on GitHub"}
          </a>
          <nav aria-label="Previous and next" className="mt-8 grid gap-4 sm:grid-cols-2">
            {previous ? <Neighbour page={previous} direction="previous" /> : <span />}
            {next && <Neighbour page={next} direction="next" />}
          </nav>
        </div>
      </article>
      <Toc items={toc} />
    </div>
  );
}

function Neighbour({ page, direction }: { page: DocPage; direction: "previous" | "next" }) {
  return (
    <Link
      href={docHref(page.slug)}
      className={
        "group rounded-xl border border-border p-4 transition-colors hover:bg-gray-2 " +
        (direction === "next" ? "text-right sm:col-start-2" : "")
      }
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground group-[.text-right]:justify-end">
        {direction === "previous" && <ArrowLeft className="size-3" />}
        {direction === "previous" ? "Previous" : "Next"}
        {direction === "next" && <ArrowRight className="size-3" />}
      </span>
      <span className="mt-1 block font-medium">{page.title}</span>
    </Link>
  );
}
