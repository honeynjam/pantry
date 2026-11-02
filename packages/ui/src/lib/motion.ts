"use client";

import { useReducedMotion, type Transition } from "motion/react";

/** Outside packages/ui, import `motion` (and `AnimatePresence`) from here (lint enforces it), next to the tokens it animates with. */
export { AnimatePresence, motion } from "motion/react";

/**
 * Motion tokens (spec §9d). The only timing values the app animates with.
 * CSS mirrors live in styles/globals.css (--duration-*, --ease-*, --ease-spring-*).
 *
 * Rules: animate transform and opacity; one continuous movement per state change; springs for
 * anything the user can reverse; exits faster than entrances; every animation has a reduced-motion
 * branch that keeps the end state and drops the travel.
 */

/** Springs. `duration` + `bounce` match the sampled CSS `linear()` curves. */
export const spring = {
  /** ~0.4s, no bounce: panels, heights, drawers, sidebar width, anything that reports state. */
  smooth: { type: "spring", duration: 0.4, bounce: 0 },
  /** ~0.26s, slight bounce: presses, small indicators, icon swaps. */
  snappy: { type: "spring", duration: 0.26, bounce: 0.15 },
  /** ~0.42s, slight bounce: shared highlights via layoutId (tabs, list selection, menus). */
  morph: { type: "spring", duration: 0.42, bounce: 0.15 },
} as const satisfies Record<string, Transition>;

/** Tween durations in seconds. */
export const duration = {
  instant: 0.12,
  fast: 0.16,
  exit: 0.18,
  standard: 0.24,
} as const;

/** Cubic-bezier eases as motion arrays. */
export const ease = {
  /** Entrances: moves at once, settles softly. */
  out: [0.23, 1, 0.32, 1],
  /** Exits: accelerates away. */
  in: [0.55, 0, 1, 0.45],
  /** Movement between two on-screen positions. */
  inOut: [0.77, 0, 0.175, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Press feedback scale (elements that anchor a menu or popover don't scale). */
export const pressScale = 0.97;

export const tween = {
  enter: { duration: duration.fast, ease: ease.out },
  exit: { duration: duration.instant, ease: ease.in },
  panelEnter: { duration: duration.standard, ease: ease.out },
  panelExit: { duration: duration.exit, ease: ease.in },
} as const satisfies Record<string, Transition>;

/**
 * Marketing reveals (apps/site only; the app never uses these). Longer and softer than the app
 * tokens because they run once, as content arrives, not in answer to an action.
 * `words`: headline words rise out of a blur one after another. `block`: a section fades up once
 * when it scrolls into view. Reduced motion drops the blur and travel and keeps a short fade.
 */
export const reveal = {
  words: { duration: 0.8, ease: ease.out, stagger: 0.045, blur: 10, distance: "0.35em" },
  block: { duration: 0.7, ease: ease.out, stagger: 0.08, distance: 16 },
  /** How much of an element must be on screen before it reveals. */
  amount: 0.5,
} as const;

/** The reduced-motion branch: no travel, a short opacity cross-fade keeps feedback. */
export const reducedTransition = {
  duration: duration.instant,
  ease: "linear",
} as const satisfies Transition;

/**
 * Pick a transition with its reduced-motion branch.
 * `useMotionTransition(spring.morph)` → the spring, or a short fade when the user asks for less motion.
 */
export function useMotionTransition(transition: Transition): Transition {
  const reduce = useReducedMotion();
  return reduce ? reducedTransition : transition;
}

/** Whether to drop travel (translate / scale / layout). Wraps motion's `useReducedMotion`. */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}
