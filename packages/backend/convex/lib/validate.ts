import { fail } from "./errors";

/** Space keys: 2–10 characters, a letter then letters or digits (`PAN`, `WEB2`). */
export const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * Colours are a curated palette name (`violet`, resolved to a design token by the app) or a hex value
 * (the default status colours). Nothing else, so stored values are always safe to put in CSS.
 */
const COLOR_PATTERN = /^(?:[a-z]{3,12}|#[0-9a-fA-F]{6})$/;

/** Trimmed, single-spaced name of 1–`max` characters. */
export function cleanName(value: string, what: string, max = 80): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) fail("INVALID_NAME", `${what} can't be empty.`);
  if (name.length > max) fail("INVALID_NAME", `${what} can be at most ${max} characters.`);
  return name;
}

export function checkColor(color: string): string {
  if (!COLOR_PATTERN.test(color)) fail("INVALID_COLOR", "Pick a colour from the palette.");
  return color;
}

/**
 * The curated palette the app offers for labels and projects (packages/ui `LABEL_COLORS` mirrors it;
 * a test in packages/app keeps them equal). MCP accepts only these names, so an agent can't store a
 * colour the app has no swatch for.
 */
export const PALETTE = [
  "gray",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type PaletteColor = (typeof PALETTE)[number];

/** A palette name (any case), or an error listing the palette. */
export function checkPaletteColor(color: string): PaletteColor {
  const name = color.trim().toLowerCase();
  if (!(PALETTE as readonly string[]).includes(name)) {
    fail("INVALID_COLOR", `No colour "${color.trim()}". Colours: ${PALETTE.join(", ")}.`);
  }
  return name as PaletteColor;
}
