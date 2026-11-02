"use client";

import { IssueKey } from "@pantry/ui/components/issue-key";
import { Button } from "@pantry/ui/components/button";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { NewSpaceDialog } from "../../components/new-space-dialog";
import { SpaceAvatar } from "../../components/space-avatar";
import { routes, useNavigation } from "../../navigation";
import type { WorkspaceData } from "../../shell/app-shell";
import { KIND_LABEL, kindOf, modeOf, vocabulary } from "../../lib/vocabulary";
import { SettingsEmpty, SettingsGroup, SettingsList, SettingsPanel } from "./parts";

function projectCount(data: WorkspaceData, spaceId: string): string {
  const count = data.projects.filter((project) => project.spaceId === spaceId).length;
  return count === 0 ? "" : `${count} ${count === 1 ? "project" : "projects"}`;
}

export function SpacesSettings({ data }: { data: WorkspaceData }) {
  const { Link } = useNavigation();
  const [creating, setCreating] = useState(false);
  const mode = modeOf(data.workspace);
  const words = vocabulary(mode);
  return (
    <SettingsPanel
      title={words.many}
      description={`Each ${words.one} has its own key, issues, context doc and projects. Open one to rename it, edit its context doc, manage its projects or archive it.`}
      actions={
        <Button onClick={() => setCreating(true)} data-icon="inline-start">
          <PlusIcon />
          {words.newLabel}
        </Button>
      }
    >
      <SettingsGroup
        title="Active"
        hint={<span className="tabular font-mono">{data.spaces.length}</span>}
      >
        {data.spaces.length === 0 ? (
          <SettingsEmpty>Nothing here yet.</SettingsEmpty>
        ) : (
          <SettingsList>
            {data.spaces.map((space) => (
              <li key={space._id}>
                <Link
                  href={routes.spaceSettings(space.key)}
                  className="group h-row hover:bg-accent flex items-center gap-3 px-3 text-sm transition-colors duration-(--duration-instant)"
                >
                  <SpaceAvatar space={space} size="sm" />
                  <span className="text-foreground min-w-0 flex-1 truncate">{space.name}</span>
                  {(words.asksKind || kindOf(space) !== words.defaultKind) && (
                    <span className="text-muted-foreground text-xs">
                      {KIND_LABEL[kindOf(space)].one}
                    </span>
                  )}
                  <span className="text-muted-foreground tabular text-xs">
                    {projectCount(data, space._id)}
                  </span>
                  <IssueKey value={space.key} />
                  <span
                    className="text-muted-foreground tabular font-mono text-xs"
                    title="Issues created so far"
                  >
                    {space.nextIssueNumber - 1} issues
                  </span>
                  <ChevronRightIcon
                    className="text-faint-foreground group-hover:text-muted-foreground size-3.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </SettingsList>
        )}
      </SettingsGroup>
      <NewSpaceDialog open={creating} onOpenChange={setCreating} mode={mode} />
    </SettingsPanel>
  );
}
