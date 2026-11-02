"use client";

import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import { Button } from "@pantry/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@pantry/ui/components/field";
import { Input } from "@pantry/ui/components/input";
import { useMutation } from "convex/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { EntryGate, type EntryState } from "../entry";
import { useAuthClient } from "../providers";
import { AuthLayout } from "./auth-layout";
import { describeError, FormError } from "./form-error";
import { SlowHint } from "./slow-hint";

/** First run: fix a missing secret, then create the owner account and the workspace. */
export function SetupPage() {
  return (
    <EntryGate allow={["needs-secret", "needs-setup"]}>
      {(state) =>
        state.kind === "needs-setup" ? <CreateWorkspace state={state} /> : <MissingSecret />
      }
    </EntryGate>
  );
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** Shown while the Convex deployment has no BETTER_AUTH_SECRET (the deploy key couldn't set it). */
function MissingSecret() {
  const [secret] = useState(randomSecret);
  const command = `npx convex env set BETTER_AUTH_SECRET '${secret}'`;
  return (
    <AuthLayout
      wide
      title="One more step"
      description="This server's Convex deployment has no BETTER_AUTH_SECRET yet, so nobody can sign in. Set it once; it survives redeploys."
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground font-medium">
            Run this in the repo, from packages/backend
          </span>
          <div className="border-border bg-gray-2 flex items-start gap-1 rounded-md border p-1 pl-2.5">
            <code className="text-foreground min-w-0 flex-1 py-1 font-mono text-xs leading-5 break-all">
              {command}
            </code>
            <CopyButton text={command} label="Copy command" />
          </div>
          <span className="text-muted-foreground text-xs">
            Add <code className="font-mono">--prod</code> for a deployed instance. The value was
            generated in your browser and isn&apos;t stored anywhere.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground font-medium">Or in the Convex dashboard</span>
          <span className="text-muted-foreground">
            Settings → Environment Variables → add{" "}
            <code className="text-foreground font-mono">BETTER_AUTH_SECRET</code> with the value
            above.
          </span>
        </div>
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          I&apos;ve set it, check again
        </Button>
      </div>
    </AuthLayout>
  );
}

/**
 * Workspace details wait here between sign-up and the moment Convex sees the new session. Module
 * scope (not a ref) because the entry gate briefly shows its loading screen during that hand-off,
 * which unmounts the form.
 */
let queuedWorkspace: { workspaceName: string; displayName?: string } | null = null;

function CreateWorkspace({ state }: { state: Extract<EntryState, { kind: "needs-setup" }> }) {
  const authClient = useAuthClient();
  const createWorkspace = useMutation(api.setup.createWorkspace);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!state.signedIn || !queuedWorkspace) return;
    const args = queuedWorkspace;
    queuedWorkspace = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects the queued request after remount
    setPending(true);
    createWorkspace(args).catch((err: unknown) => {
      setPending(false);
      setError(describeError(err, "Couldn't create the workspace. Try again."));
    });
    // On success the entry gate moves on to the workspace.
  }, [state.signedIn, createWorkspace]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const workspaceName = String(form.get("workspace") ?? "").trim();
    setPending(true);
    setError(null);

    if (state.signedIn) {
      try {
        await createWorkspace({ workspaceName });
      } catch (err) {
        setPending(false);
        setError(describeError(err, "Couldn't create the workspace. Try again."));
      }
      return;
    }

    const name = String(form.get("name")).trim();
    queuedWorkspace = { workspaceName, displayName: name };
    const { error } = await authClient.signUp.email({
      name,
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    if (error) {
      queuedWorkspace = null;
      setPending(false);
      setError(describeError(error, "Couldn't create your account. Try again."));
    }
  }

  return (
    <AuthLayout
      wide
      title={`Set up ${brand.name}`}
      description="You're the first person here, so you'll own this workspace. After this, people join by invite only."
    >
      <form onSubmit={onSubmit}>
        <FieldGroup className="gap-4">
          {!state.signedIn && (
            <>
              <Field>
                <FieldLabel htmlFor="setup-name">Your name</FieldLabel>
                <Input id="setup-name" name="name" autoComplete="name" required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-email">Email</FieldLabel>
                <Input id="setup-email" name="email" type="email" autoComplete="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-password">Password</FieldLabel>
                <Input
                  id="setup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <FieldDescription>At least 8 characters.</FieldDescription>
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="setup-workspace">Workspace name</FieldLabel>
            <Input
              id="setup-workspace"
              name="workspace"
              placeholder="e.g. Home"
              autoFocus={state.signedIn}
            />
            <FieldDescription>
              Optional. Next, a few quick questions to set it up for how you work.
            </FieldDescription>
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Creating workspace…" : "Create workspace"}
          </Button>
          <SlowHint pending={pending} />
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
