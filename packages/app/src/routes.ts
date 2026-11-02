// Plain module (no "use client"): server components import it through `@pantry/app/routes`.
// Values imported from the package root are client references on the server and can't be called.

export const SETTINGS_SECTIONS = [
  "general",
  "members",
  "spaces",
  "labels",
  "statuses",
  "tokens",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  setup: "/setup",
  myIssues: "/my-issues",
  /** Onboarding. `again` walks the steps with the current values (Workspace settings, user menu). */
  welcome: "/welcome",
  welcomeAgain: "/welcome?again=1",
  space: (key: string) => `/spaces/${encodeURIComponent(key)}`,
  board: (key: string) => `/spaces/${encodeURIComponent(key)}/board`,
  spaceSettings: (key: string) => `/spaces/${encodeURIComponent(key)}/settings`,
  issue: (key: string) => `/issues/${encodeURIComponent(key)}`,
  settings: (section: SettingsSection = "members") => `/settings/${section}`,
} as const;
