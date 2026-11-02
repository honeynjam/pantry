import {
  HomePage,
  NavigationProvider,
  PantryProviders,
  SpacePage,
  routes,
  SetupPage,
  SignInPage,
  SignUpPage,
  WelcomePage,
} from "@pantry/app";
import { Toaster } from "@pantry/ui/components/sonner";
import { TooltipProvider } from "@pantry/ui/components/tooltip";
import { ThemeProvider } from "@pantry/ui/lib/theme";
import { useMemoryNavigation } from "./navigation";
import { SpikeStatus } from "./spike-status";

const server = __PANTRY_SERVER__;

export function App() {
  return (
    <ThemeProvider storageKey="pantry-theme">
      <TooltipProvider>
        {server ? (
          // crossDomain: the webview (tauri://localhost) calls the .convex.site auth routes directly.
          <PantryProviders
            convexUrl={server.convexUrl}
            authBaseUrl={server.convexSiteUrl}
            crossDomain
          >
            <Routes />
            <SpikeStatus source={server.source} />
          </PantryProviders>
        ) : (
          <NoServer />
        )}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function Routes() {
  const navigation = useMemoryNavigation(routes.home);
  const { pathname } = navigation;
  const spaceKey = pathname.match(/^\/spaces\/([^/]+)$/)?.[1];
  return (
    <NavigationProvider value={navigation}>
      {pathname === routes.signIn ? (
        <SignInPage />
      ) : pathname === routes.signUp ? (
        <SignUpPage />
      ) : pathname === routes.setup ? (
        <SetupPage />
      ) : pathname === routes.welcome ? (
        <WelcomePage />
      ) : spaceKey ? (
        <SpacePage spaceKey={decodeURIComponent(spaceKey)} />
      ) : (
        <HomePage />
      )}
    </NavigationProvider>
  );
}

function NoServer() {
  return (
    <main className="text-muted-foreground grid min-h-svh place-items-center p-6 text-sm">
      <p className="max-w-sm text-center">
        This build has no server. Rebuild with{" "}
        <code className="font-mono">PANTRY_SERVER_URL=https://your-app</code>, or run{" "}
        <code className="font-mono">pnpm dev</code> first so the local backend URL exists.
      </p>
    </main>
  );
}
