import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { SiteFooter } from "@/components/sections";
import { SiteNav } from "@/components/site-nav";
import { getStarCount } from "@/lib/github";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const stars = await getStarCount();
  return (
    <>
      <SiteNav stars={stars} />
      <div data-nav-theme="light" className="light bg-background text-foreground">
        <div className="mx-auto grid w-full max-w-7xl px-5 sm:px-8 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-12">
          <DocsSidebar />
          <main className="min-w-0">{children}</main>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
