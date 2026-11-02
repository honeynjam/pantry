"use client";

import { Button } from "@pantry/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@pantry/ui/components/field";
import { Input } from "@pantry/ui/components/input";
import { useState, type FormEvent } from "react";
import { EntryGate } from "../entry";
import { routes, useNavigation } from "../navigation";
import { useAuthClient } from "../providers";
import { AuthLayout } from "./auth-layout";
import { AcceptInvite, withInvite } from "./accept-invite";
import { describeError, FormError } from "./form-error";
import { SlowHint } from "./slow-hint";

const SIGNED_OUT = ["signed-out"] as const;
const SIGNED_OUT_OR_JOINING = ["signed-out", "not-member"] as const;

/** Sign in. With `?invite=` (someone who already has an account), the invite is accepted after. */
export function SignInPage({ inviteToken }: { inviteToken?: string }) {
  if (!inviteToken) return <EntryGate allow={SIGNED_OUT}>{() => <SignInForm />}</EntryGate>;
  return (
    <EntryGate allow={SIGNED_OUT_OR_JOINING}>
      {(state) =>
        state.kind === "not-member" ? (
          <AcceptInvite token={inviteToken} />
        ) : (
          <SignInForm inviteToken={inviteToken} />
        )
      }
    </EntryGate>
  );
}

/**
 * The sign-in card. The OAuth consent screen reuses it (with its own title and no invite footer):
 * after signing in, the page it's on moves on by itself.
 */
export function SignInForm({
  inviteToken,
  title = "Sign in",
  description,
  showFooter = true,
}: {
  inviteToken?: string;
  title?: string;
  description?: string;
  showFooter?: boolean;
}) {
  const authClient = useAuthClient();
  const { Link } = useNavigation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    // On success the entry gate sees the session and moves on to the workspace.
    if (error) setError(describeError(error, "Couldn't sign in. Check your email and password."));
  }

  return (
    <AuthLayout
      title={title}
      description={
        description ?? (inviteToken ? "Sign in to accept your invite." : "Welcome back.")
      }
      footer={
        showFooter && (
          <>
            Have an invite?{" "}
            <Link
              href={withInvite(routes.signUp, inviteToken)}
              className="text-foreground decoration-gray-8 underline underline-offset-4 hover:decoration-current"
            >
              Create your account
            </Link>
          </>
        )
      }
    >
      <form onSubmit={onSubmit} noValidate={false}>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
            <Input
              id="sign-in-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Input
              id="sign-in-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <SlowHint pending={pending} />
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
