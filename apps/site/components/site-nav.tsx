"use client";

import * as React from "react";
import Link from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Keyboard, Laptop, Menu, Server, Sparkles, X } from "lucide-react";
import { tween, useMotionTransition } from "@pantry/ui/lib/motion";
import { cn } from "@pantry/ui/lib/utils";
import { links, nav } from "@/lib/content";
import { formatStars } from "@/lib/format";
import { DeployButton } from "./cta";
import { GitHubLogo } from "./logos";
import { PantryLogo } from "./pantry-logo";

const PRODUCT_ICONS = {
  agents: Sparkles,
  speed: Keyboard,
  mac: Laptop,
  "self-host": Server,
} as const;

/**
 * Sticky nav that takes the theme of the section under it (sections carry `data-nav-theme`),
 * so it stays light over light sections and dark over dark ones, like plane.so.
 */
export function SiteNav({ stars }: { stars: number | null }) {
  const theme = useThemeUnderNav();
  const [open, setOpen] = React.useState(false);
  const fade = useMotionTransition(tween.panelEnter);

  return (
    <header
      className={cn(
        theme,
        "text-foreground sticky top-0 z-50 border-b border-transparent bg-[color-mix(in_oklch,var(--background)_80%,transparent)] backdrop-blur-xl backdrop-saturate-150 transition-[background-color,border-color] duration-300",
        "data-[scrolled=true]:border-border",
      )}
      data-scrolled={useScrolled()}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-5 sm:px-8">
        <Link href="/" aria-label="Pantry home" className="mr-4 text-lg">
          <PantryLogo playful />
        </Link>

        <NavigationMenu.Root className="max-md:hidden">
          <NavigationMenu.List className="flex items-center gap-0.5">
            <NavigationMenu.Item>
              <NavigationMenu.Trigger className="group text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground flex h-8 cursor-pointer items-center gap-1 rounded-md px-3 text-sm transition-colors">
                {nav.product.label}
                <NavigationMenu.Icon className="transition-transform duration-200 ease-out group-data-[popup-open]:rotate-180">
                  <ChevronDown className="size-3.5" />
                </NavigationMenu.Icon>
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className="grid w-[34rem] grid-cols-2 gap-1 p-2">
                {nav.product.items.map((item) => {
                  const Icon = PRODUCT_ICONS[item.id as keyof typeof PRODUCT_ICONS];
                  return (
                    <NavigationMenu.Link
                      key={item.id}
                      href={`/#${item.id}`}
                      className="group/link hover:bg-accent flex gap-3 rounded-lg p-3 transition-colors"
                    >
                      <span className="border-border bg-background text-muted-foreground group-hover/link:text-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
                        <Icon className="size-4" />
                      </span>
                      <span>
                        <span className="text-foreground flex items-center gap-2 text-sm font-medium">
                          {item.label}
                          {item.badge && (
                            <span className="border-border text-2xs text-muted-foreground rounded-full border px-1.5 font-normal">
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-5">
                          {item.body}
                        </span>
                      </span>
                    </NavigationMenu.Link>
                  );
                })}
              </NavigationMenu.Content>
            </NavigationMenu.Item>
            {nav.links.map((link) => (
              <NavigationMenu.Item key={link.href}>
                <NavigationMenu.Link
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground flex h-8 items-center rounded-md px-3 text-sm transition-colors"
                >
                  {link.label}
                </NavigationMenu.Link>
              </NavigationMenu.Item>
            ))}
          </NavigationMenu.List>

          <NavigationMenu.Portal>
            <NavigationMenu.Positioner sideOffset={10} align="start" className={cn(theme, "z-50")}>
              <NavigationMenu.Popup className="bg-popover text-foreground shadow-overlay origin-[var(--transform-origin)] rounded-xl transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
                <NavigationMenu.Viewport />
              </NavigationMenu.Popup>
            </NavigationMenu.Positioner>
          </NavigationMenu.Portal>
        </NavigationMenu.Root>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={links.repo}
            className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors"
          >
            <GitHubLogo className="size-4" />
            <span className="max-sm:sr-only">GitHub</span>
            {stars !== null && (
              <span className="bg-muted text-foreground tabular rounded-full px-1.5 text-xs">
                {formatStars(stars)}
              </span>
            )}
          </a>
          <DeployButton size="sm" className="max-sm:hidden" />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="text-foreground flex size-9 items-center justify-center rounded-md md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0, transition: tween.panelExit }}
            transition={fade}
            className="border-border overflow-hidden border-t md:hidden"
          >
            <ul className="space-y-1 px-5 py-4">
              {[...nav.product.items, ...nav.links.map((link) => ({ ...link, id: link.href }))].map(
                (item) => (
                  <li key={item.id}>
                    <a
                      href={"href" in item ? item.href : `/#${item.id}`}
                      onClick={() => setOpen(false)}
                      className="text-foreground flex h-11 items-center text-lg"
                    >
                      {item.label}
                    </a>
                  </li>
                ),
              )}
              <li className="pt-3">
                <DeployButton className="w-full" />
              </li>
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/** The `data-nav-theme` of the section currently under the nav bar. */
function useThemeUnderNav(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const probe = 32; // the nav's vertical centre
      for (const section of document.querySelectorAll<HTMLElement>("[data-nav-theme]")) {
        const rect = section.getBoundingClientRect();
        if (rect.top <= probe && rect.bottom > probe) {
          setTheme(section.dataset.navTheme === "dark" ? "dark" : "light");
          return;
        }
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return theme;
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}
