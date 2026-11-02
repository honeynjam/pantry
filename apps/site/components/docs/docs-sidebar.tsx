"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@pantry/ui/lib/utils";
import { DOCS_NAV, docHref } from "@/lib/docs/nav";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="space-y-7">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <h2 className="px-2 font-sans text-xs font-medium tracking-normal text-muted-foreground">{section.title}</h2>
          <ul className="mt-2 space-y-0.5">
            {section.pages.map((page) => {
              const href = docHref(page.slug);
              const active = pathname === href;
              return (
                <li key={page.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active ? "bg-gray-4 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The docs page list: a sticky column on large screens, a disclosure above the page on small ones. */
export function DocsSidebar() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto py-10 pr-2 lg:block">
        <NavList />
      </aside>
      <div className="border-b border-border py-3 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          Docs menu
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </button>
        {open && (
          <div className="pt-4 pb-2">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
    </>
  );
}
