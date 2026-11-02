"use client";

import { Button } from "@pantry/ui/components/button";
import { SegmentedControl } from "@pantry/ui/components/segmented-control";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { MODE_CHOICES, useSetMode } from "../../onboarding/mode-choice";
import { modeOf, vocabulary, type Mode } from "../../lib/vocabulary";
import { routes, useNavigation } from "../../navigation";
import type { WorkspaceData } from "../../shell/app-shell";
import { describeError } from "../form-error";
import { SettingsGroup, SettingsPanel } from "./parts";

/** Workspace settings → General: what the workspace works on, and running setup again. */
export function GeneralSettings({ data }: { data: WorkspaceData }) {
  const isOwner = data.me.role === "owner";
  const mode = modeOf(data.workspace);
  const setMode = useSetMode();
  const { navigate } = useNavigation();

  async function change(next: Mode) {
    try {
      await setMode({ mode: next });
      toast(`Now set up for ${vocabulary(next).many.toLowerCase()}`);
    } catch (err) {
      toast.error(describeError(err, "Couldn't change the work type."));
    }
  }

  return (
    <SettingsPanel title="General" description={data.workspace.name}>
      <SettingsGroup title="Work type">
        <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
          {isOwner ? (
            <SegmentedControl
              aria-label="What this workspace works on"
              value={mode}
              onValueChange={(next) => void change(next)}
              options={MODE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
            />
          ) : (
            <span className="text-foreground text-sm">
              {MODE_CHOICES.find((choice) => choice.value === mode)?.label}
            </span>
          )}
          <p className="text-muted-foreground text-xs">
            Sets the words in the sidebar and what new spaces start as. Existing{" "}
            {vocabulary("both").many.toLowerCase()} keep their kind.
            {!isOwner && " Only the owner can change it."}
          </p>
        </div>
      </SettingsGroup>
      <SettingsGroup title={isOwner ? "Setup" : "Onboarding"}>
        <div className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <p className="text-muted-foreground flex-1 text-sm">
            {isOwner
              ? "Walk through the setup steps again with what you have now. Nothing is recreated."
              : "See the short welcome again: theme, connecting your agent and the keys to know."}
          </p>
          <Button
            variant="secondary"
            onClick={() => navigate(routes.welcomeAgain)}
            data-icon="inline-start"
          >
            <RotateCcwIcon />
            {isOwner ? "Run setup again" : "Show onboarding"}
          </Button>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  );
}
