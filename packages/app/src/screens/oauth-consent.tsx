"use client";

import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import { Button } from "@pantry/ui/components/button";
import { useAction, useMutation, useQuery } from "convex/react";
import { BadgeCheckIcon, LaptopIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EntryGate } from "../entry";
import { routes, useNavigation } from "../navigation";
import { AuthLayout } from "./auth-layout";
import { describeError, FormError } from "./form-error";
import { LoadingScreen } from "./loading";
import { NotMemberScreen } from "./not-member";
import { SignInForm } from "./sign-in";

const ALLOWED = ["signed-out", "not-member", "ready"] as const;

/**
 * The MCP OAuth consent screen (/oauth/consent?request=…). /api/oauth/authorize parks a checked
 * request in Convex and sends the browser here; signing in happens on this page, then the member
 * sees who's asking and where they'll be sent, and allows or denies. Either way the browser goes back
 * to the app's redirect URI. With `?error=` (a request we wouldn't redirect), it explains instead.
 *
 * Allow and Deny are Convex calls authenticated by the member's session token, not by a cookie, so
 * another site can't submit them (no CSRF); the page can't be framed (next.config.ts headers).
 */
export function OAuthConsentPage({
  requestId,
  error,
  errorDescription,
}: {
  requestId?: string;
  error?: string;
  errorDescription?: string;
}) {
  if (error || !requestId) {
    return (
      <Problem title="Can't connect this app">
        {errorDescription ?? "The link is incomplete. Start connecting again from the app."}
      </Problem>
    );
  }
  return (
    <EntryGate allow={ALLOWED}>
      {(state) =>
        state.kind === "signed-out" ? (
          <SignInForm
            title="Sign in to connect an app"
            description={`An app wants to use ${brand.name} as you. Sign in first.`}
            showFooter={false}
          />
        ) : state.kind === "not-member" ? (
          <NotMemberScreen />
        ) : (
          <Consent requestId={requestId} />
        )
      }
    </EntryGate>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  const { Link } = useNavigation();
  return (
    <AuthLayout
      title={title}
      description={children}
      footer={
        <Link
          href={routes.home}
          className="text-foreground decoration-gray-8 underline underline-offset-4 hover:decoration-current"
        >
          Go to {brand.name}
        </Link>
      }
    >
      {null}
    </AuthLayout>
  );
}

function Consent({ requestId }: { requestId: string }) {
  const request = useQuery(api.oauth.request, { requestId });
  const approve = useAction(api.oauth.approve);
  const deny = useMutation(api.oauth.deny);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (request === undefined) return <LoadingScreen />;
  if (request === null && !leaving) {
    return (
      <Problem title="This request expired">
        Requests last 10 minutes. Go back to the app and start connecting again.
      </Problem>
    );
  }

  async function answer(choice: "allow" | "deny") {
    if (pending) return;
    setPending(choice);
    setError(null);
    try {
      const { redirectTo } =
        choice === "allow" ? await approve({ requestId }) : await deny({ requestId });
      setLeaving(true);
      window.location.assign(redirectTo);
    } catch (err) {
      setError(describeError(err, "Couldn't finish connecting. Try again."));
      setPending(null);
    }
  }

  if (leaving || !request) {
    return (
      <AuthLayout
        title={pending === "deny" ? "Not connected" : "Connected"}
        description="Taking you back to the app…"
      >
        {null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      wide
      title={`Connect ${request.clientName}?`}
      description={
        <>
          {request.clientName} wants to use {brand.name} as you in{" "}
          <span className="text-foreground">{request.workspaceName}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="divide-border border-border divide-y rounded-lg border text-sm">
          <Fact label="App">
            <span className="text-foreground truncate">{request.clientName}</span>
            {request.verifiedHost ? (
              <span
                className="text-muted-foreground flex items-center gap-1 font-mono text-xs"
                title={`${brand.name} read this app's details from ${request.verifiedHost}`}
              >
                <BadgeCheckIcon className="size-3.5" aria-hidden />
                {request.verifiedHost}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">name not verified</span>
            )}
          </Fact>
          <Fact label="Sends you to">
            <span className="text-foreground font-mono text-xs">{request.redirectHost}</span>
          </Fact>
          <Fact label="Acts as">
            <span className="text-foreground truncate">{request.memberName}</span>
          </Fact>
        </dl>
        <p className="text-muted-foreground text-xs leading-5">
          It can do what an API token can: read, create and change issues, comments, spaces,
          projects and labels. Its changes show under your name, tagged “via MCP”. Disconnect it any
          time in Settings → API tokens.
        </p>
        {request.loopback && (
          <p className="border-border text-muted-foreground flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-5">
            <LaptopIcon className="text-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              This app runs on your computer. Only allow it if you just started connecting it
              yourself.
            </span>
          </p>
        )}
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            disabled={pending !== null}
            onClick={() => void answer("deny")}
          >
            {pending === "deny" ? "Cancelling…" : "Cancel"}
          </Button>
          <Button size="lg" disabled={pending !== null} onClick={() => void answer("allow")}>
            {pending === "allow" ? "Connecting…" : "Allow"}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-3 py-1.5">
      <dt className="text-muted-foreground w-24 shrink-0 text-xs">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">{children}</dd>
    </div>
  );
}
