"use client";

import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import type { Id } from "@pantry/backend/dataModel";
import { Button } from "@pantry/ui/components/button";
import { Input } from "@pantry/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pantry/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pantry/ui/components/tooltip";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheckIcon, KeyRoundIcon, PlugIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { CopyButton } from "../../components/copy-button";
import { fullDate, timeAgo } from "../../lib/format";
import { describeError, FormError } from "../form-error";
import {
  claudeCodeSnippet,
  CONNECTOR_STEPS,
  cursorEnvSnippet,
  cursorSnippet,
  mcpUrl,
  TOKEN_ENV_VAR,
} from "./mcp-snippets";
import { SettingsEmpty, SettingsGroup, SettingsList, SettingsPanel, SettingsRow } from "./parts";

export type CreatedToken = { name: string; token: string };
type TokenRow = FunctionReturnType<typeof api.tokens.list>[number];
type ConnectionRow = FunctionReturnType<typeof api.oauth.connections>[number];

/** User settings → API tokens (spec §6): personal tokens for MCP clients, plus the client snippets. */
export function TokensSettings() {
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const url = mcpUrl(window.location.origin);
  return (
    <SettingsPanel
      title="API tokens"
      description={
        <>
          Personal tokens for AI agents working over MCP, and the apps you connected by signing in.
          Either acts as you: its comments and changes show under your name, tagged “via MCP”.
        </>
      }
    >
      <CreateToken created={created} onCreated={setCreated} />
      <ClientSnippets url={url} token={created?.token} />
      <TokenList />
      <ConnectedApps />
    </SettingsPanel>
  );
}

export function CreateToken({
  created,
  onCreated,
  defaultName,
  autoFocus = false,
}: {
  created: CreatedToken | null;
  onCreated: (token: CreatedToken) => void;
  /** Prefills the name (onboarding suggests one). */
  defaultName?: string;
  autoFocus?: boolean;
}) {
  const createToken = useAction(api.tokens.create);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    const name = String(new FormData(formElement).get("name") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = await createToken({ name });
      onCreated({ name: result.name, token: result.token });
      formElement.reset();
    } catch (err) {
      setError(describeError(err, "Couldn't create the token. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup title="New token">
      <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <KeyRoundIcon
              className="text-faint-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              name="name"
              required
              maxLength={60}
              placeholder="Claude Code on my laptop"
              defaultValue={defaultName}
              aria-label="Token name"
              autoComplete="off"
              autoFocus={autoFocus}
              className="pl-8"
            />
          </div>
          <Button type="submit" disabled={pending} data-icon="inline-start">
            <PlusIcon />
            {pending ? "Creating…" : "Create token"}
          </Button>
        </form>
        <FormError message={error} />
        {created ? (
          <div className="bg-gray-2 flex flex-col gap-2 rounded-md p-2.5" role="status">
            <div className="border-border bg-background flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2.5">
              <code
                className="text-foreground min-w-0 flex-1 truncate font-mono text-xs"
                title={created.token}
              >
                {created.token}
              </code>
              <CopyButton text={created.token} label="Copy token" variant="secondary">
                Copy token
              </CopyButton>
            </div>
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground">{created.name}</span> is ready. Copy it now: you
              won&apos;t see it again. The snippets below already include it.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Name it after where it lives, so you know which one to revoke. You see the token once.
          </p>
        )}
      </div>
    </SettingsGroup>
  );
}

function Snippet({ text, label }: { text: string; label: string }) {
  return (
    <div className="border-border bg-gray-2 flex items-start gap-1 rounded-md border p-1 pl-2.5">
      <pre className="text-foreground min-w-0 flex-1 py-1 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={label} />
    </div>
  );
}

export function ClientSnippets({ url, token }: { url: string; token: string | undefined }) {
  return (
    <SettingsGroup title="Connect an agent">
      <Tabs defaultValue="claude-code" className="border-border rounded-lg border p-3">
        <TabsList>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="claude">Claude app</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
        </TabsList>
        <TabsContent value="claude" className="flex flex-col gap-2">
          <ConnectorSteps url={url} steps={CONNECTOR_STEPS.claude} />
        </TabsContent>
        <TabsContent value="chatgpt" className="flex flex-col gap-2">
          <ConnectorSteps url={url} steps={CONNECTOR_STEPS.chatgpt} />
        </TabsContent>
        <TabsContent value="claude-code" className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Run this in a terminal{token ? "" : ", with your token in place of the placeholder"}:
          </p>
          <Snippet text={claudeCodeSnippet(url, token)} label="Copy Claude Code command" />
          <p className="text-muted-foreground text-xs">
            Then ask it to work on an issue, for example “work on {brand.defaultKey}-12”. It reads
            the issue and the space&apos;s context doc first.
          </p>
        </TabsContent>
        <TabsContent value="cursor" className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Add this to <code className="text-foreground font-mono">~/.cursor/mcp.json</code> (or
            the project&apos;s <code className="text-foreground font-mono">.cursor/mcp.json</code>):
          </p>
          <Snippet text={cursorSnippet(url)} label="Copy Cursor config" />
          <p className="text-muted-foreground text-xs">
            It reads the token from{" "}
            <code className="text-foreground font-mono">{TOKEN_ENV_VAR}</code>, so the file holds no
            secret. Set it where Cursor starts, for example in your shell profile:
          </p>
          <Snippet text={cursorEnvSnippet(token)} label="Copy environment line" />
        </TabsContent>
      </Tabs>
    </SettingsGroup>
  );
}

/** Claude and ChatGPT connect with the URL alone and sign in (OAuth): no token to copy. */
function ConnectorSteps({ url, steps }: { url: string; steps: readonly string[] }) {
  return (
    <>
      <p className="text-muted-foreground text-xs">
        No token needed: it signs in to {brand.name} in your browser and shows up under Connected
        apps below.
      </p>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5 text-xs leading-5">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <Snippet text={url} label="Copy server URL" />
    </>
  );
}

function TokenList() {
  const tokens = useQuery(api.tokens.list);
  const revoke = useMutation(api.tokens.revoke);
  // Kept after the dialog closes, so its title doesn't change while it animates out.
  const [target, setTarget] = useState<TokenRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (tokens === undefined) return null;

  const active = tokens.filter((token) => token.revokedAt === undefined);
  const revoked = tokens.filter((token) => token.revokedAt !== undefined).slice(0, 10);

  async function onRevoke(tokenId: Id<"apiTokens">, name: string) {
    try {
      await revoke({ tokenId });
      toast(`${name} revoked`);
    } catch (err) {
      toast.error(describeError(err, "Couldn't revoke the token."));
    }
  }

  return (
    <>
      <SettingsGroup
        title="Your tokens"
        hint={<span className="tabular font-mono">{active.length}</span>}
      >
        {active.length === 0 ? (
          <SettingsEmpty>No tokens yet. Create one above to connect an agent.</SettingsEmpty>
        ) : (
          <SettingsList>
            {active.map((token) => (
              <SettingsRow key={token._id}>
                <KeyRoundIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-foreground min-w-0 flex-1 truncate">{token.name}</span>
                <code
                  className="text-muted-foreground font-mono text-xs"
                  title="The start of the token"
                >
                  {token.tokenPrefix}…
                </code>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="text-muted-foreground w-28 text-right text-xs" />}
                  >
                    {token.lastUsedAt ? `Used ${timeAgo(token.lastUsedAt)}` : "Never used"}
                  </TooltipTrigger>
                  <TooltipContent>
                    Created {fullDate(token._creationTime)}.
                    {token.lastUsedAt
                      ? ` Last used ${fullDate(token.lastUsedAt)} (updated every 10 minutes at most).`
                      : ""}
                  </TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTarget(token);
                    setConfirmOpen(true);
                  }}
                >
                  Revoke
                </Button>
              </SettingsRow>
            ))}
          </SettingsList>
        )}
      </SettingsGroup>
      {revoked.length > 0 && (
        <SettingsGroup title="Revoked">
          <SettingsList>
            {revoked.map((token) => (
              <SettingsRow key={token._id} className="text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{token.name}</span>
                <code className="font-mono text-xs">{token.tokenPrefix}…</code>
                <span className="w-28 text-right text-xs" title={fullDate(token.revokedAt!)}>
                  Revoked {timeAgo(token.revokedAt!)}
                </span>
              </SettingsRow>
            ))}
          </SettingsList>
        </SettingsGroup>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Revoke “${target?.name ?? ""}”?`}
        description="Agents using this token stop working at once. This can't be undone; create a new token to reconnect."
        confirmLabel="Revoke token"
        destructive
        onConfirm={async () => {
          if (target) await onRevoke(target._id, target.name);
        }}
      />
    </>
  );
}

/** Apps connected by signing in (Claude, ChatGPT…): one row each, with Disconnect. */
function ConnectedApps() {
  const connections = useQuery(api.oauth.connections);
  const disconnect = useMutation(api.oauth.disconnect);
  const [target, setTarget] = useState<ConnectionRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (connections === undefined) return null;

  return (
    <>
      <SettingsGroup
        title="Connected apps"
        hint={<span className="tabular font-mono">{connections.length}</span>}
      >
        {connections.length === 0 ? (
          <SettingsEmpty>
            No apps yet. Claude and ChatGPT appear here after you connect them with the URL above.
          </SettingsEmpty>
        ) : (
          <SettingsList>
            {connections.map((app) => (
              <SettingsRow key={app._id}>
                <PlugIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-foreground min-w-0 flex-1 truncate">{app.name}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs" />
                    }
                  >
                    {app.verified && <BadgeCheckIcon className="size-3" aria-hidden />}
                    {app.host}
                  </TooltipTrigger>
                  <TooltipContent>
                    {app.verified
                      ? `Identified by ${app.host}.`
                      : `Sends sign-ins back to ${app.host}. Its name is what the app said about itself.`}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="text-muted-foreground w-28 text-right text-xs" />}
                  >
                    {app.lastUsedAt ? `Used ${timeAgo(app.lastUsedAt)}` : "Never used"}
                  </TooltipTrigger>
                  <TooltipContent>
                    Connected {fullDate(app._creationTime)}.
                    {app.lastUsedAt
                      ? ` Last used ${fullDate(app.lastUsedAt)} (updated every 10 minutes at most).`
                      : ""}
                  </TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTarget(app);
                    setConfirmOpen(true);
                  }}
                >
                  Disconnect
                </Button>
              </SettingsRow>
            ))}
          </SettingsList>
        )}
      </SettingsGroup>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Disconnect “${target?.name ?? ""}”?`}
        description="It loses access at once. To use it again, connect it again from the app."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          if (!target) return;
          try {
            await disconnect({ grantId: target._id });
            toast(`${target.name} disconnected`);
          } catch (err) {
            toast.error(describeError(err, "Couldn't disconnect the app."));
          }
        }}
      />
    </>
  );
}
