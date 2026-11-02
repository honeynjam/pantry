"use client";

import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { SidebarMenuButton } from "@pantry/ui/components/sidebar";
import { useTheme, type Theme } from "@pantry/ui/lib/theme";
import {
  ChevronsUpDownIcon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
} from "lucide-react";
import { routes, useNavigation } from "../navigation";
import { useAuthClient } from "../providers";

/** Footer button: who's signed in, theme choice, onboarding again and sign out. */
export function UserMenu({ displayName, isOwner }: { displayName: string; isOwner: boolean }) {
  const authClient = useAuthClient();
  const session = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const { navigate } = useNavigation();
  const email = session.data?.user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            tooltip={displayName}
            className="data-popup-open:bg-sidebar-accent"
          />
        }
      >
        <PersonAvatar person={{ name: displayName }} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-foreground truncate text-sm font-medium">{displayName}</span>
          {email && <span className="text-muted-foreground truncate text-xs">{email}</span>}
        </span>
        <ChevronsUpDownIcon className="text-muted-foreground ml-auto size-3.5!" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(routes.settings("tokens"))}>
          <KeyRoundIcon />
          API tokens
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(routes.welcomeAgain)}>
          <RotateCcwIcon />
          {isOwner ? "Run setup again" : "Show onboarding"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void authClient.signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
