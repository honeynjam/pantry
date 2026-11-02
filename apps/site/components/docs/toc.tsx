import type { TocItem } from "@/lib/docs/markdown";
import { cn } from "@pantry/ui/lib/utils";

/** "On this page": the h2s and h3s of the current page. */
export function Toc({ items }: { items: TocItem[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="On this page" className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto xl:block">
      <p className="text-xs font-medium text-muted-foreground">On this page</p>
      <ul className="mt-3 space-y-2 border-l border-border">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "-ml-px block border-l border-transparent text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground",
                item.depth === 2 ? "pl-3" : "pl-6",
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
