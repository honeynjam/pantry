"use client";

import { brand } from "@pantry/backend/brand";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { Keycap } from "@pantry/ui/components/keycap";
import { SegmentedControl } from "@pantry/ui/components/segmented-control";
import { useTheme, type Theme } from "@pantry/ui/lib/theme";
import { MonitorIcon, MoonIcon, SunIcon, UserIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { SpaceAvatar } from "../components/space-avatar";
import { groupSpaces, modeOf, type Mode } from "../lib/vocabulary";
import { InviteForm } from "../screens/settings/members";
import { mcpUrl } from "../screens/settings/mcp-snippets";
import { ClientSnippets, CreateToken, type CreatedToken } from "../screens/settings/tokens";
import type { WorkspaceData } from "../shell/app-shell";
import { shortcut } from "../shortcuts";
import { ContinueButton, Step, StepHeader } from "./frame";
import { ChoiceCards, MODE_CHOICES, type Choice } from "./mode-choice";

/** Step 1 (owner): what the workspace works on. Sets the words and the default kind of spaces. */
export function WorkStep({
  value,
  onChange,
  pending,
  onContinue,
}: {
  value: Mode | null;
  onChange: (mode: Mode) => void;
  pending: boolean;
  onContinue: () => void;
}) {
  return (
    <Step
      onBack={null}
      onContinue={value ? onContinue : null}
      footer={
        <ContinueButton disabled={!value} pending={pending} onClick={onContinue}>
          {pending ? "Saving…" : "Continue"}
        </ContinueButton>
      }
    >
      <StepHeader title="What do you work on?">
        {brand.name} names things after it: products, clients or both, in the sidebar and everywhere
        else. You can change it later in Settings.
      </StepHeader>
      <ChoiceCards
        name="mode"
        legend="What do you work on?"
        choices={MODE_CHOICES}
        value={value}
        onChange={onChange}
        autoFocus
      />
    </Step>
  );
}

type Team = "solo" | "team";
const TEAM_CHOICES: ReadonlyArray<Choice<Team>> = [
  { value: "solo", label: "Just me", description: "You and your agents.", icon: UserIcon },
  {
    value: "team",
    label: "With others",
    description: "Invite people to work alongside you.",
    icon: UsersIcon,
  },
];

/** Step 3 (owner): working alone, or invite people now with links like Settings → Members. */
export function TeamStep({
  data,
  onBack,
  onNext,
}: {
  data: WorkspaceData;
  onBack: () => void;
  onNext: () => void;
}) {
  const others = data.members.filter((member) => member._id !== data.me._id);
  const [team, setTeam] = useState<Team | null>(others.length > 0 ? "team" : null);
  return (
    <Step
      onBack={onBack}
      onContinue={team ? onNext : null}
      footer={
        <ContinueButton
          disabled={!team}
          onClick={onNext}
          // Creating an invite is the main thing to do here once you've said "with others".
          variant={team === "team" ? "secondary" : "default"}
        >
          Continue
        </ContinueButton>
      }
    >
      <StepHeader title="Working with others?">
        {team === "team"
          ? `Each invite is a link for one email address. ${brand.name} doesn't send email: copy each link and send it yourself.`
          : "People join by invite only. You can also invite them later from Settings."}
      </StepHeader>
      <ChoiceCards
        name="team"
        legend="Working with others?"
        choices={TEAM_CHOICES}
        value={team}
        onChange={setTeam}
        autoFocus
      />
      {team === "team" && (
        <div className="flex flex-col gap-3">
          {others.length > 0 && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className="flex -space-x-1">
                {others.slice(0, 5).map((member) => (
                  <PersonAvatar
                    key={member._id}
                    person={{ name: member.displayName, avatarUrl: member.avatarUrl }}
                    size="sm"
                  />
                ))}
              </span>
              Already here: {others.map((member) => member.displayName).join(", ")}
            </div>
          )}
          <InviteForm title="Invite by email" />
        </div>
      )}
    </Step>
  );
}

/** Step 4 (owner and members): a personal token and the snippet for Claude Code or Cursor. */
export function AgentStep({ onBack, onNext }: { onBack: (() => void) | null; onNext: () => void }) {
  const [created, setCreated] = useState<CreatedToken | null>(null);
  return (
    <Step
      onBack={onBack}
      onContinue={onNext}
      footer={
        created ? (
          <ContinueButton onClick={onNext}>Continue</ContinueButton>
        ) : (
          <ContinueButton variant="secondary" onClick={onNext}>
            Skip for now
          </ContinueButton>
        )
      }
    >
      <StepHeader title="Connect your AI agent">
        Agents like Claude Code and Cursor work in {brand.name} over MCP: they read an issue and its
        context doc, move it along and comment, as you, tagged “via MCP”. They need a personal
        token.
      </StepHeader>
      <div className="flex flex-col gap-5">
        <CreateToken created={created} onCreated={setCreated} defaultName="Claude Code" autoFocus />
        <ClientSnippets url={mcpUrl(window.location.origin)} token={created?.token} />
      </div>
    </Step>
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
] as const;

/** The four keys that do most of the work, from the registry so they can't drift. */
const PRIMER = [
  { keys: [shortcut("palette").display], label: "Command palette: go anywhere, do anything" },
  { keys: [shortcut("newIssue").display], label: "New issue, from anywhere" },
  {
    keys: [shortcut("next").display, shortcut("previous").display],
    label: "Move down and up a list",
  },
  { keys: [shortcut("help").display], label: "Every other shortcut" },
];

/** Last step (owner and members): theme and the keyboard primer, then into the first space. */
export function FinishStep({
  landing,
  pending,
  onBack,
  onFinish,
}: {
  /** Where Finish goes: the first space, or Home when there is none. */
  landing: string | null;
  pending: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <Step
      onBack={onBack}
      onContinue={onFinish}
      footer={
        <ContinueButton pending={pending} onClick={onFinish}>
          {landing ? `Open ${landing}` : "Finish"}
        </ContinueButton>
      }
    >
      <StepHeader title="Make it yours">
        Pick a theme, and the four keys that do most of the work.
      </StepHeader>
      <section aria-labelledby="onboarding-theme" className="flex flex-col gap-2">
        <h2
          id="onboarding-theme"
          className="text-muted-foreground font-sans text-xs font-medium tracking-normal"
        >
          Theme
        </h2>
        <SegmentedControl
          aria-label="Theme"
          value={theme}
          onValueChange={(next: Theme) => setTheme(next)}
          options={THEME_OPTIONS}
        />
      </section>
      <section aria-labelledby="onboarding-keys" className="flex flex-col gap-2">
        <h2
          id="onboarding-keys"
          className="text-muted-foreground font-sans text-xs font-medium tracking-normal"
        >
          Keyboard
        </h2>
        <dl className="divide-border border-border flex flex-col divide-y rounded-lg border">
          {PRIMER.map((row) => (
            <div key={row.label} className="h-row flex items-center gap-3 px-3 text-sm">
              <dt className="flex w-16 shrink-0 items-center gap-1">
                {row.keys.map((keys, index) => (
                  <Keycap key={index} keys={keys} />
                ))}
              </dt>
              <dd className="text-foreground min-w-0 flex-1">{row.label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">
          Letter keys never fire while you&apos;re typing.
        </p>
      </section>
    </Step>
  );
}

/** First step for invited members: where they've landed and who's here. */
export function MemberWelcomeStep({ data, onNext }: { data: WorkspaceData; onNext: () => void }) {
  const owner = data.members.find((member) => member.role === "owner");
  const groups = groupSpaces(modeOf(data.workspace), data.spaces).filter(
    (group) => group.spaces.length > 0,
  );
  return (
    <Step
      onBack={null}
      onContinue={onNext}
      footer={<ContinueButton onClick={onNext}>Continue</ContinueButton>}
    >
      <StepHeader title={`Welcome to ${data.workspace.name}`}>
        {owner && owner._id !== data.me._id ? `${owner.displayName} set it up. ` : ""}A quick
        minute: connect your agent and pick a theme, then you&apos;re in.
      </StepHeader>
      {groups.map((group) => (
        <section key={group.kind} className="flex flex-col gap-2" aria-label={group.heading}>
          <h2 className="text-muted-foreground font-sans text-xs font-medium tracking-normal">
            {group.heading}
          </h2>
          <ul className="divide-border border-border flex flex-col divide-y rounded-lg border">
            {group.spaces.map((space) => (
              <li key={space._id} className="h-row flex items-center gap-3 px-3 text-sm">
                <SpaceAvatar space={space} size="sm" />
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                  {space.name}
                </span>
                <span className="text-muted-foreground font-mono text-xs">{space.key}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="flex flex-col gap-2" aria-label="People">
        <h2 className="text-muted-foreground font-sans text-xs font-medium tracking-normal">
          People
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {data.members.map((member) => (
            <span key={member._id} className="flex items-center gap-2 text-sm">
              <PersonAvatar
                person={{ name: member.displayName, avatarUrl: member.avatarUrl }}
                size="sm"
              />
              <span className="text-foreground">
                {member.displayName}
                {member._id === data.me._id && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
            </span>
          ))}
        </div>
      </section>
    </Step>
  );
}
