"use client";

import * as React from "react";
import { Kbd, KbdGroup } from "@pantry/ui/components/kbd";
import { cn } from "@pantry/ui/lib/utils";

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  meta: "⌘",
  cmd: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};
const OTHER_SYMBOLS: Record<string, string> = {
  mod: "Ctrl",
  meta: "Win",
  cmd: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};
const NAMED: Record<string, string> = {
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

function subscribe() {
  return () => {};
}
function getIsMac() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}
// Server render assumes Mac (the primary platform); the client corrects it after hydration.
const getServerIsMac = () => true;

export function useIsMac(): boolean {
  return React.useSyncExternalStore(subscribe, getIsMac, getServerIsMac);
}

/** "mod+shift+k" → ["⌘", "⇧", "K"] (or Ctrl / Shift / K off Mac). */
export function formatChord(chord: string, isMac: boolean): string[] {
  return chord
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      return (
        (isMac ? MAC_SYMBOLS : OTHER_SYMBOLS)[lower] ??
        NAMED[lower] ??
        (part.length === 1 || /^f\d{1,2}$/.test(lower) ? part.toUpperCase() : part)
      );
    });
}

/**
 * Keyboard shortcut hint. `keys` uses tinykeys-style notation: "mod+k", "shift+c", and
 * space-separated sequences like "g i" (rendered "G then I").
 */
function Keycap({
  keys,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { keys: string }) {
  const isMac = useIsMac();
  const steps = keys.trim().split(/\s+/);
  return (
    <span data-slot="keycap" className={cn("inline-flex items-center gap-1", className)} {...props}>
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="text-2xs text-muted-foreground">then</span>}
          <KbdGroup>
            {formatChord(step, isMac).map((key, keyIndex) => (
              <Kbd key={keyIndex}>{key}</Kbd>
            ))}
          </KbdGroup>
        </React.Fragment>
      ))}
    </span>
  );
}

export { Keycap };
