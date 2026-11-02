"use client";

// Client-only React screens, hooks and providers. No next/* imports: this package must build
// statically for Tauri (M5). Hosts provide routing through NavigationProvider.
export {
  NavigationProvider,
  routes,
  SETTINGS_SECTIONS,
  type LinkProps,
  type Navigation,
  type SettingsSection,
} from "./navigation";
export { PantryProviders, useAuthClient } from "./providers";
export { createPantryAuthClient, type PantryAuthClient } from "./auth-client";
export { EntryGate, useEntryState, type EntryState } from "./entry";
export { deriveEntryState, type SetupStatus } from "./entry-state";
export { SignInPage } from "./screens/sign-in";
export { SignUpPage } from "./screens/sign-up";
export { SetupPage } from "./screens/setup";
export { HomePage } from "./screens/home";
export { SpacePage } from "./screens/space";
export { LoadingScreen } from "./screens/loading";
export { SettingsPage } from "./screens/settings/settings-page";
export { SpaceSettingsPage } from "./screens/space-settings";
export { IssuePage } from "./screens/issue";
export { BoardPage } from "./screens/board";
export { MyIssuesPage } from "./screens/my-issues";
export { WelcomePage } from "./screens/welcome";
