"use client";

import { api } from "@pantry/backend/api";
import { cn } from "@pantry/ui/lib/utils";
import { useMutation } from "convex/react";
import { BriefcaseIcon, CheckIcon, LayersIcon, PackageIcon, type LucideIcon } from "lucide-react";
import type { Mode } from "../lib/vocabulary";

export const MODE_CHOICES: ReadonlyArray<{
  value: Mode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "product",
    label: "Products",
    description: "Your own apps, sites or tools.",
    icon: PackageIcon,
  },
  {
    value: "client",
    label: "Client work",
    description: "Work for clients, one space each.",
    icon: BriefcaseIcon,
  },
  {
    value: "both",
    label: "Both",
    description: "Products and client work, side by side.",
    icon: LayersIcon,
  },
];

/** workspace.setMode, with the new mode in the sidebar at once. */
export function useSetMode() {
  return useMutation(api.workspace.setMode).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.workspace.current, {});
    if (current) {
      store.setQuery(
        api.workspace.current,
        {},
        { ...current, workspace: { ...current.workspace, mode: args.mode } },
      );
    }
  });
}

export type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
  icon: LucideIcon;
};

/**
 * One choice among a few, as cards. Native radio inputs underneath, so arrow keys, focus and screen
 * readers work as for any radio group; the parent decides what Enter does (continue).
 */
export function ChoiceCards<T extends string>({
  name,
  legend,
  choices,
  value,
  onChange,
  autoFocus = false,
}: {
  name: string;
  legend: string;
  choices: ReadonlyArray<Choice<T>>;
  value: T | null;
  onChange: (value: T) => void;
  autoFocus?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{legend}</legend>
      {choices.map((choice) => {
        const checked = choice.value === value;
        const Icon = choice.icon;
        return (
          <label
            key={choice.value}
            className={cn(
              "group border-border relative flex cursor-default items-center gap-3 rounded-lg border px-3.5 py-3",
              "transition-[background-color,border-color] duration-(--duration-instant)",
              "hover:bg-accent has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
              checked && "border-border-strong bg-gray-2 hover:bg-gray-2",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={checked}
              onChange={() => onChange(choice.value)}
              // The selected card (or the first) takes the step's focus, so arrows and Enter work at once.
              data-autofocus={
                autoFocus && (checked || (value === null && choice === choices[0])) ? "" : undefined
              }
              className="sr-only"
            />
            <span
              className={cn(
                "border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border",
                checked ? "text-foreground" : "text-muted-foreground",
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-foreground text-sm font-medium">{choice.label}</span>
              <span className="text-muted-foreground text-xs">{choice.description}</span>
            </span>
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-strong",
              )}
              aria-hidden
            >
              {checked && <CheckIcon className="size-2.5" strokeWidth={3} />}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
