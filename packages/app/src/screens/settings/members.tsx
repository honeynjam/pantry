"use client";

import { api } from "@pantry/backend/api";
import type { Id } from "@pantry/backend/dataModel";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { Badge } from "@pantry/ui/components/badge";
import { Button } from "@pantry/ui/components/button";
import { Input } from "@pantry/ui/components/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pantry/ui/components/tooltip";
import { useAction, useMutation, useQuery } from "convex/react";
import { LinkIcon, MailIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CopyButton } from "../../components/copy-button";
import { fullDate, timeAgo } from "../../lib/format";
import type { WorkspaceData } from "../../shell/app-shell";
import { describeError, FormError } from "../form-error";
import { SettingsEmpty, SettingsGroup, SettingsList, SettingsPanel, SettingsRow } from "./parts";

export function MembersSettings({ data }: { data: WorkspaceData }) {
  const isOwner = data.me.role === "owner";
  return (
    <SettingsPanel
      title="Members"
      description="People in this workspace. Agents aren't members: they work over MCP as the person whose token they use."
    >
      {isOwner && <InviteForm />}
      <SettingsGroup
        title="Members"
        hint={<span className="tabular font-mono">{data.members.length}</span>}
      >
        <SettingsList>
          {data.members.map((member) => (
            <SettingsRow key={member._id}>
              <PersonAvatar
                person={{ name: member.displayName, avatarUrl: member.avatarUrl }}
                size="sm"
              />
              <span className="text-foreground min-w-0 flex-1 truncate">
                {member.displayName}
                {member._id === data.me._id && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
              <Badge variant={member.role === "owner" ? "default" : "outline"}>
                {member.role === "owner" ? "Owner" : "Member"}
              </Badge>
            </SettingsRow>
          ))}
        </SettingsList>
      </SettingsGroup>
      {isOwner && <InviteList data={data} />}
    </SettingsPanel>
  );
}

type CreatedInvite = { email: string; link: string; expiresAt: number };

/**
 * Owner only: one email at a time, each giving a link to copy and send yourself (nothing is
 * emailed). Links created while the form is open stay listed, newest first, so inviting a few
 * people in a row doesn't lose the earlier links. Used by Settings → Members and onboarding.
 */
export function InviteForm({
  title = "Invite someone",
  autoFocus = false,
}: {
  title?: string;
  autoFocus?: boolean;
}) {
  const createInvite = useAction(api.invites.create);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite[]>([]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    const email = String(new FormData(formElement).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = await createInvite({ email });
      const link =
        result.url ??
        `${window.location.origin}/sign-up?invite=${encodeURIComponent(result.token)}`;
      const invite = { email: email.toLowerCase(), link, expiresAt: result.expiresAt };
      setCreated((list) => [invite, ...list.filter((item) => item.email !== invite.email)]);
      formElement.reset();
    } catch (err) {
      setError(describeError(err, "Couldn't create the invite. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup title={title}>
      <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <MailIcon
              className="text-faint-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              name="email"
              type="email"
              required
              placeholder="partner@example.com"
              aria-label="Email address to invite"
              autoComplete="off"
              autoFocus={autoFocus}
              className="pl-8"
            />
          </div>
          <Button type="submit" disabled={pending} data-icon="inline-start">
            <LinkIcon />
            {pending ? "Creating…" : "Create invite link"}
          </Button>
        </form>
        <FormError message={error} />
        {created.length > 0 ? (
          <div className="bg-gray-2 flex flex-col gap-2 rounded-md p-2.5" role="status">
            {created.map((invite) => (
              <div key={invite.link} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  For <span className="text-foreground">{invite.email}</span>
                </span>
                <div className="border-border bg-background flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2.5">
                  <code
                    className="text-foreground min-w-0 flex-1 truncate font-mono text-xs"
                    title={invite.link}
                  >
                    {invite.link}
                  </code>
                  <CopyButton
                    text={invite.link}
                    label={`Copy invite link for ${invite.email}`}
                    variant="secondary"
                  >
                    Copy link
                  </CopyButton>
                </div>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              Send {created.length === 1 ? "this link" : "each link"} yourself; nothing is emailed.
              Each works once, for its address, until {fullDate(created[0]!.expiresAt)}. You
              won&apos;t see {created.length === 1 ? "it" : "them"} again: create a new one if one
              gets lost.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            You get a link to copy and send yourself. It expires after 7 days and only works for
            that email address.
          </p>
        )}
      </div>
    </SettingsGroup>
  );
}

export function InviteList({ data }: { data: WorkspaceData }) {
  const invites = useQuery(api.invites.list);
  const revoke = useMutation(api.invites.revoke);
  const [revoking, setRevoking] = useState<Id<"invites"> | null>(null);
  if (invites === undefined) return null;

  const pending = invites.filter((invite) => invite.state === "pending");
  const past = invites.filter((invite) => invite.state !== "pending").slice(0, 10);
  const memberName = (id: Id<"members">) =>
    data.members.find((member) => member._id === id)?.displayName ?? "Someone";

  async function onRevoke(inviteId: Id<"invites">, email: string) {
    setRevoking(inviteId);
    try {
      await revoke({ inviteId });
      toast(`Invite for ${email} revoked`);
    } catch (err) {
      toast.error(describeError(err, "Couldn't revoke the invite."));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <SettingsGroup
        title="Pending invites"
        hint={<span className="tabular font-mono">{pending.length}</span>}
      >
        {pending.length === 0 ? (
          <SettingsEmpty>No pending invites.</SettingsEmpty>
        ) : (
          <SettingsList>
            {pending.map((invite) => (
              <SettingsRow key={invite._id}>
                <MailIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-foreground min-w-0 flex-1 truncate">{invite.email}</span>
                <Tooltip>
                  <TooltipTrigger render={<span className="text-muted-foreground text-xs" />}>
                    Expires {timeAgo(invite.expiresAt)}
                  </TooltipTrigger>
                  <TooltipContent>
                    Created by {memberName(invite.createdBy)} {timeAgo(invite._creationTime)}.
                    Expires {fullDate(invite.expiresAt)}.
                  </TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoking === invite._id}
                  onClick={() => void onRevoke(invite._id, invite.email)}
                >
                  Revoke
                </Button>
              </SettingsRow>
            ))}
          </SettingsList>
        )}
      </SettingsGroup>
      {past.length > 0 && (
        <SettingsGroup title="Past invites">
          <SettingsList>
            {past.map((invite) => (
              <SettingsRow key={invite._id} className="text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                <span
                  className="text-xs"
                  title={fullDate(invite.acceptedAt ?? invite.revokedAt ?? invite.expiresAt)}
                >
                  {timeAgo(invite.acceptedAt ?? invite.revokedAt ?? invite.expiresAt)}
                </span>
                <Badge
                  variant={invite.state === "accepted" ? "secondary" : "outline"}
                  className="w-16 justify-center"
                >
                  {invite.state === "accepted"
                    ? "Joined"
                    : invite.state === "revoked"
                      ? "Revoked"
                      : "Expired"}
                </Badge>
              </SettingsRow>
            ))}
          </SettingsList>
        </SettingsGroup>
      )}
    </>
  );
}
