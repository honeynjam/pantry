"use client";

import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import { LogoMark } from "@pantry/ui/components/logo-mark";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@pantry/ui/components/sidebar";
import { motion, spring, usePrefersReducedMotion } from "@pantry/ui/lib/motion";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import { Keycap } from "@pantry/ui/components/keycap";
import { RollingNumber } from "@pantry/ui/components/rolling-number";
import {
  ChevronRightIcon,
  CircleUserRoundIcon,
  HouseIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type { Doc } from "@pantry/backend/dataModel";
import type { Project } from "@pantry/backend/model";
import { cn } from "@pantry/ui/lib/utils";
import { useEffect, useState, type ReactNode } from "react";
import { preloadMarkdownEditor, whenIdle } from "../components/markdown-editor";
import { SpaceAvatar } from "../components/space-avatar";
import { parseFilters, slug } from "../issues/filters";
import { useStable } from "../lib/stable";
import { routes, useNavigation } from "../navigation";
import { LoadingScreen } from "../screens/loading";
import { AppCommandsProvider, useAppCommands } from "./app-commands";
import { groupSpaces, KIND_LABEL, modeOf } from "../lib/vocabulary";
import { projectColor } from "./space-color";
import { UserMenu } from "./user-menu";

export type WorkspaceData = FunctionReturnType<typeof api.workspace.current>;

const SIDEBAR_KEY = `${brand.name.toLowerCase()}-sidebar-open`;

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

/** One highlight for the whole nav: it glides between items on spring.morph (reduced: no travel). */
function NavItem({
  href,
  tooltip,
  active,
  badge,
  action,
  children,
}: {
  href: string;
  tooltip: string;
  active: boolean;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { Link } = useNavigation();
  // Reduced motion: no shared layoutId, so the highlight appears in place without travel.
  const reduceMotion = usePrefersReducedMotion();
  return (
    <SidebarMenuItem>
      {active && (
        <motion.span
          layoutId={reduceMotion ? undefined : "sidebar-active"}
          transition={spring.morph}
          aria-hidden
          className="bg-selected absolute inset-0 rounded-md"
        />
      )}
      <SidebarMenuButton
        render={<Link href={href} aria-current={active ? "page" : undefined} />}
        tooltip={tooltip}
        className={
          active ? "text-foreground relative font-medium hover:bg-transparent" : "relative"
        }
      >
        {children}
      </SidebarMenuButton>
      {badge !== undefined && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
      {action}
    </SidebarMenuItem>
  );
}

/**
 * A space in the sidebar, with a chevron that shows its projects (the current space starts open).
 * A project opens the space's list (or board, if that's on screen) filtered to it.
 */
function SpaceNavItem({ space, projects }: { space: Doc<"spaces">; projects: Project[] }) {
  const { pathname, search, Link } = useNavigation();
  const reduceMotion = usePrefersReducedMotion();
  const list = routes.space(space.key);
  const board = routes.board(space.key);
  const onSpace = pathname === list || pathname.startsWith(`${list}/`);
  const onView = pathname === list || pathname === board;
  const filtered = onView ? parseFilters(search).project : [];
  const activeProject = filtered.length === 1 ? filtered[0] : undefined;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = projects.length > 0 && (toggled ?? onSpace);

  return (
    <>
      <NavItem
        href={list}
        tooltip={space.name}
        active={
          onSpace &&
          !(activeProject && projects.some((project) => slug(project.name) === activeProject))
        }
        badge={<span className={cn(projects.length > 0 && "mr-5")}>{space.key}</span>}
        action={
          projects.length > 0 ? (
            <SidebarMenuAction
              aria-label={open ? `Hide ${space.name}'s projects` : `Show ${space.name}'s projects`}
              aria-expanded={open}
              onClick={() => setToggled(!open)}
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5! transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
            </SidebarMenuAction>
          ) : undefined
        }
      >
        <span className="flex size-4 items-center justify-center" aria-hidden>
          <SpaceAvatar space={space} size="xs" />
        </span>
        <span>{space.name}</span>
      </NavItem>
      {open && (
        <SidebarMenuSub aria-label={`${space.name} projects`}>
          {projects.map((project) => {
            const value = slug(project.name);
            const active = activeProject === value;
            return (
              <SidebarMenuSubItem key={project._id}>
                {active && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : "sidebar-active"}
                    transition={spring.morph}
                    aria-hidden
                    className="bg-selected absolute inset-0 -translate-x-px rounded-md"
                  />
                )}
                <SidebarMenuSubButton
                  render={
                    <Link
                      href={`${pathname === board ? board : list}?project=${encodeURIComponent(value)}`}
                      aria-current={active ? "page" : undefined}
                    />
                  }
                  className={cn(
                    "relative",
                    active && "text-foreground font-medium hover:bg-transparent",
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: projectColor(project) }}
                    aria-hidden
                  />
                  <span>{project.name}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      )}
    </>
  );
}

function AppSidebar({ data }: { data: WorkspaceData }) {
  const { pathname } = useNavigation();
  const { openPalette, newSpace } = useAppCommands();
  const mine = useQuery(api.issues.listMine);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<div />}
              size="lg"
              tooltip={data.workspace.name}
              className="hover:bg-transparent"
            >
              <LogoMark name={data.workspace.name} />
              <span className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-sm font-semibold">
                  {data.workspace.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {data.members.length} {data.members.length === 1 ? "member" : "members"}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Search"
                onClick={openPalette}
                aria-keyshortcuts="Meta+K Control+K"
              >
                <SearchIcon />
                <span>Search</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>
                <Keycap keys="mod+k" />
              </SidebarMenuBadge>
            </SidebarMenuItem>
            <NavItem href={routes.home} tooltip="Home" active={pathname === routes.home}>
              <HouseIcon />
              <span>Home</span>
            </NavItem>
            <NavItem
              href={routes.myIssues}
              tooltip="My issues"
              active={pathname === routes.myIssues}
              badge={mine === undefined ? undefined : <RollingNumber value={mine.length} />}
            >
              <CircleUserRoundIcon />
              <span>My issues</span>
            </NavItem>
          </SidebarMenu>
        </SidebarGroup>
        {groupSpaces(modeOf(data.workspace), data.spaces).map((group) => (
          <SidebarGroup key={group.kind}>
            <SidebarGroupLabel>{group.heading}</SidebarGroupLabel>
            <SidebarGroupAction
              title={`New ${KIND_LABEL[group.kind].one.toLowerCase()}`}
              aria-label={`New ${KIND_LABEL[group.kind].one.toLowerCase()}`}
              onClick={() => newSpace(group.kind)}
            >
              <PlusIcon />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.spaces.map((space) => (
                  <SpaceNavItem
                    key={space._id}
                    space={space}
                    projects={data.projects.filter((project) => project.spaceId === space._id)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <NavItem
            href={routes.settings()}
            tooltip="Settings"
            active={pathname.startsWith("/settings")}
          >
            <SettingsIcon />
            <span>Settings</span>
          </NavItem>
          <SidebarMenuItem>
            <UserMenu displayName={data.me.displayName} isOwner={data.me.role === "owner"} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Right after a deploy that changed the data model, the server migrates the old rows (seconds;
 * `migrations:run`). Until it's done the screens would show half the data, so they wait here; the
 * page comes back by itself when the migration finishes (workspace.current is live).
 */
function Upgrading() {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center"
    >
      <LoaderCircleIcon
        className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      <p className="text-foreground text-sm font-medium">Finishing an upgrade</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        Your issues are being moved to the new spaces layout. This page comes back by itself in a
        moment.
      </p>
    </div>
  );
}

/** Sidebar + page frame. The collapsed state is saved per device. */
export function AppShell({
  title,
  children,
}: {
  title: (data: WorkspaceData) => ReactNode;
  children: (data: WorkspaceData) => ReactNode;
}) {
  // Stable: a change to one space or member doesn't hand every screen new statuses, labels, members.
  const data = useStable(useQuery(api.workspace.current));
  const [open, setOpen] = useState(readSidebarOpen);
  const { navigate } = useNavigation();
  // C opens the new-issue dialog from anywhere: have its editor ready by then.
  useEffect(() => whenIdle(preloadMarkdownEditor), []);
  // Members who haven't been through onboarding (new owners, new members, and everyone once after
  // the release that added it) go there first. The flag comes with workspace.current: no extra read.
  const needsOnboarding = data !== undefined && data.me.onboardedAt === undefined;
  useEffect(() => {
    if (needsOnboarding) navigate(routes.welcome, { replace: true });
  }, [needsOnboarding, navigate]);
  if (data === undefined || needsOnboarding)
    return <LoadingScreen diagnostics={() => ({ waitingFor: "workspace.current" })} />;
  return (
    <SidebarProvider
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        try {
          localStorage.setItem(SIDEBAR_KEY, String(next));
        } catch {
          // Storage can be unavailable; the choice still applies for this session.
        }
      }}
    >
      <AppCommandsProvider data={data}>
        <AppSidebar data={data} />
        <SidebarInset className="min-w-0">
          <header className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger title="Fold the sidebar ( [ )" aria-keyshortcuts="[" />
            <div className="flex min-w-0 items-center gap-2 text-sm">{title(data)}</div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">
            {data.upgrading ? <Upgrading /> : children(data)}
          </main>
        </SidebarInset>
      </AppCommandsProvider>
    </SidebarProvider>
  );
}
