import * as React from "react";
import Link from "next/link";
import { GitPullRequest } from "lucide-react";
import { cn } from "@pantry/ui/lib/utils";
import {
  agents,
  finalCta,
  footer,
  hero,
  leftOut,
  links,
  mac,
  manifesto,
  mcp,
  selfHost,
  speed,
} from "@/lib/content";
import { CtaRow, DemoLink, RunsOn } from "./cta";
import { Keys } from "./keys";
import * as Logos from "./logos";
import { McpConfig } from "./mcp-config";
import { TOOL_NAMES as toolNames } from "@/lib/docs/mcp";
import { AgentMockup } from "./mockups/agent-mockup";
import { DeployMockup } from "./mockups/deploy-mockup";
import { HeroMockup } from "./mockups/hero-mockup";
import { MacMockup } from "./mockups/mac-mockup";
import { FadeUp } from "./motion/fade-up";
import { ScrollHighlight } from "./motion/scroll-highlight";
import { StrikeList } from "./motion/strike-list";
import { WordReveal } from "./motion/word-reveal";
import { PantryLogo } from "./pantry-logo";
import { SpeedTabs } from "./speed-tabs";

/** A full-width band in one theme. The nav reads `data-nav-theme` to match it. */
function Band({
  theme,
  id,
  className,
  children,
}: {
  theme: "light" | "dark";
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-nav-theme={theme}
      className={cn(theme, "bg-background text-foreground", className)}
    >
      {children}
    </section>
  );
}

function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</div>;
}

/** Editorial header: the claim on the left, the explanation on the right. */
function SectionHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-16">
      <WordReveal text={title} className="text-headline max-w-xl font-medium" />
      <FadeUp delay={0.2}>
        <p className="text-lede text-muted-foreground max-w-md lg:mb-1">{lede}</p>
      </FadeUp>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function Hero() {
  return (
    <Band theme="light" id="top" className="pt-16 sm:pt-24">
      <Container>
        <WordReveal
          as="h1"
          trigger="mount"
          text={hero.title}
          className="text-display max-w-4xl font-medium"
        />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <FadeUp trigger="mount" delay={0.45}>
            <p className="text-lede text-muted-foreground max-w-xl">{hero.lede}</p>
          </FadeUp>
          <FadeUp trigger="mount" delay={0.6} className="space-y-4">
            <CtaRow />
            <RunsOn />
            <DemoLink />
          </FadeUp>
        </div>
      </Container>

      <Container className="mt-14 sm:mt-16">
        <FadeUp trigger="mount" delay={0.8}>
          <div className="border-border bg-gray-3 overflow-hidden rounded-2xl border px-2 pt-2 sm:px-10 sm:pt-10 lg:px-14 lg:pt-14">
            <div className="dark">
              <HeroMockup />
            </div>
          </div>
        </FadeUp>
      </Container>

      <Container className="py-16 sm:py-20">
        <FadeUp>
          <p className="text-muted-foreground text-center text-sm">{agents.worksWith}</p>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:flex lg:flex-wrap lg:items-center lg:justify-between">
            {agents.list.map((name) => {
              const Logo = Logos[`${name}Logo`];
              return (
                <li
                  key={name}
                  className="text-gray-10 hover:text-foreground flex items-center justify-center gap-2 text-[0.9375rem] font-medium tracking-tight transition-colors"
                >
                  <Logo className="size-5" />
                  {agents.names[name]}
                </li>
              );
            })}
          </ul>
        </FadeUp>
      </Container>
    </Band>
  );
}

export function Manifesto() {
  return (
    <Band theme="light" className="border-border border-t">
      <Container className="py-24 sm:py-36">
        <ScrollHighlight
          text={manifesto}
          className="font-display max-w-4xl text-[clamp(1.625rem,1.1rem+2vw,2.625rem)] leading-[1.2] font-medium tracking-[-0.03em]"
        />
      </Container>
    </Band>
  );
}

export function Agents() {
  return (
    <Band theme="dark" id={mcp.id} className="py-24 sm:py-32">
      <Container>
        <SectionHeader title={mcp.title} lede={mcp.lede} />
        <FadeUp className="mt-14">
          <div className="border-border bg-gray-2 rounded-2xl border p-2 sm:p-6">
            <AgentMockup />
          </div>
        </FadeUp>
        <div className="border-border bg-border mt-6 grid gap-px overflow-hidden rounded-2xl border md:grid-cols-3">
          {mcp.points.map((point, index) => (
            <FadeUp key={point.title} index={index} className="bg-background p-6 sm:p-8">
              <h3 className="text-lg font-medium">{point.title}</h3>
              <p className="text-body text-muted-foreground mt-2">{point.body}</p>
            </FadeUp>
          ))}
        </div>
        <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-[1fr_1.4fr]">
          <FadeUp className="border-border rounded-2xl border p-6 sm:p-8">
            <h3 className="text-lg font-medium">{mcp.toolsLabel(toolNames.length)}</h3>
            <p className="text-body text-muted-foreground mt-2">{mcp.toolsBody}</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {toolNames.map((tool) => (
                <li
                  key={tool}
                  className="border-border bg-gray-2 text-gray-11 rounded-md border px-2.5 py-1 font-mono text-xs"
                >
                  {tool}
                </li>
              ))}
            </ul>
            <Link
              href="/docs/mcp-tools"
              className="text-muted-foreground hover:text-foreground mt-6 inline-flex items-center gap-1 text-sm transition-colors"
            >
              {mcp.toolsLink} →
            </Link>
          </FadeUp>
          <FadeUp index={1}>
            <McpConfig />
          </FadeUp>
        </div>
      </Container>
    </Band>
  );
}

export function Speed() {
  return (
    <Band theme="light" id={speed.id} className="py-24 sm:py-32">
      <Container>
        <SectionHeader title={speed.title} lede={speed.lede} />
        <FadeUp className="mt-14">
          <SpeedTabs />
        </FadeUp>
        <FadeUp className="mt-6">
          <ul className="border-border flex flex-wrap items-center justify-center gap-x-8 gap-y-4 rounded-2xl border px-6 py-5">
            {speed.shortcuts.map((shortcut) => (
              <li
                key={shortcut.keys}
                className="text-muted-foreground flex items-center gap-2.5 text-sm"
              >
                <Keys keys={shortcut.keys} size="md" />
                {shortcut.label}
              </li>
            ))}
          </ul>
        </FadeUp>
      </Container>
    </Band>
  );
}

export function MacApp() {
  return (
    <Band theme="dark" id={mac.id} className="py-24 sm:py-32">
      <Container className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <FadeUp>
            <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
              <Logos.AppleLogo className="text-foreground size-4" />
              {mac.badge}
            </span>
          </FadeUp>
          <WordReveal text={mac.title} className="text-headline mt-5 font-medium" />
          <FadeUp delay={0.2}>
            <p className="text-lede text-muted-foreground mt-5">{mac.lede}</p>
          </FadeUp>
          <ul className="mt-10">
            {mac.points.map((point, index) => (
              <FadeUp
                key={point.keys}
                as="li"
                index={index}
                className="border-border text-body flex items-center justify-between gap-4 border-t py-4"
              >
                <span className="text-muted-foreground">{point.label}</span>
                <Keys keys={point.keys} size="md" />
              </FadeUp>
            ))}
          </ul>
        </div>
        <FadeUp index={1}>
          <MacMockup />
        </FadeUp>
      </Container>
    </Band>
  );
}

export function SelfHost() {
  const factLogo = {
    github: Logos.GitHubLogo,
    convex: Logos.ConvexLogo,
    vercel: Logos.VercelLogo,
    pr: GitPullRequest,
  } as const;
  return (
    <Band theme="light" id={selfHost.id} className="py-24 sm:py-32">
      <Container>
        <SectionHeader title={selfHost.title} lede={selfHost.lede} />
        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
          <ol className="space-y-8">
            {selfHost.steps.map((step, index) => (
              <FadeUp key={step.title} as="li" index={index} className="flex gap-5">
                <span className="border-border text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-medium">{step.title}</h3>
                  <p className="text-body text-muted-foreground mt-1">{step.body}</p>
                </div>
              </FadeUp>
            ))}
          </ol>
          <FadeUp index={1}>
            <div className="border-border bg-gray-3 rounded-2xl border p-2 sm:p-8">
              <DeployMockup />
            </div>
          </FadeUp>
        </div>
        <div className="border-border bg-border mt-16 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-4">
          {selfHost.facts.map((fact, index) => {
            const Logo = factLogo[fact.logo];
            return (
              <FadeUp key={fact.title} index={index} className="bg-background p-6">
                <Logo className="size-5" />
                <h3 className="mt-4 font-medium">{fact.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-6">{fact.body}</p>
              </FadeUp>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-6 text-xs">{selfHost.footnote}</p>
      </Container>
    </Band>
  );
}

export function LeftOut() {
  return (
    <Band theme="dark" className="pt-24 pb-12 sm:pt-32">
      <Container>
        <SectionHeader title={leftOut.title} lede={leftOut.lede} />
        <div className="mt-14">
          <StrikeList items={leftOut.items} />
        </div>
      </Container>
    </Band>
  );
}

export function FinalCta() {
  return (
    <Band theme="dark" className="pt-20 pb-24 sm:pt-28 sm:pb-32">
      <Container className="flex flex-col items-center text-center">
        <WordReveal text={finalCta.title} className="text-display font-medium" />
        <FadeUp delay={0.3} className="flex flex-col items-center">
          <p className="text-lede text-muted-foreground mt-5 max-w-xl">{finalCta.lede}</p>
          <CtaRow className="mt-9 justify-center" />
          <DemoLink className="mt-5" />
        </FadeUp>
      </Container>
    </Band>
  );
}

export function SiteFooter() {
  return (
    <footer
      data-nav-theme="dark"
      className="dark border-border bg-background text-foreground border-t py-14"
    >
      <Container>
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <PantryLogo className="text-lg" />
            <p className="text-muted-foreground mt-3 text-sm leading-6">{footer.tagline}</p>
          </div>
          <div className="flex gap-16">
            {footer.columns.map((column) => (
              <div key={column.title}>
                <h2 className="font-sans text-sm font-medium tracking-normal">{column.title}</h2>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-border text-muted-foreground mt-14 flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-xs">
          <span>{footer.legal}</span>
          <a
            href={links.repo}
            className="hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <Logos.GitHubLogo className="size-3.5" />
            honeynjam/pantry
          </a>
        </div>
      </Container>
    </footer>
  );
}
