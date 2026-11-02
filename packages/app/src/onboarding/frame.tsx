"use client";

import { brand } from "@pantry/backend/brand";
import { Button } from "@pantry/ui/components/button";
import { Keycap } from "@pantry/ui/components/keycap";
import { LogoMark } from "@pantry/ui/components/logo-mark";
import {
  AnimatePresence,
  motion,
  reducedTransition,
  spring,
  tween,
  usePrefersReducedMotion,
} from "@pantry/ui/lib/motion";
import { cn } from "@pantry/ui/lib/utils";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** Touch keyboards shouldn't pop open by themselves. */
export const canAutoFocus = () =>
  typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;

/**
 * The onboarding page: brand, progress and the way out on top, then one step in a narrow column.
 * Steps slide a few pixels in the direction of travel (forward = in from the right) on the smooth
 * spring and leave faster than they arrive; with reduced motion they only cross-fade. Onboarding
 * runs once, so it can afford movement the app itself saves for rarer moments.
 */
export function OnboardingFrame({
  stepKey,
  index,
  count,
  stepLabel,
  direction,
  exitLabel,
  onExit,
  children,
}: {
  stepKey: string;
  index: number;
  count: number;
  stepLabel: string;
  /** 1 going forward, -1 going back. */
  direction: 1 | -1;
  exitLabel: string;
  onExit: () => void;
  children: ReactNode;
}) {
  const reduce = usePrefersReducedMotion();
  // Variants take the direction through `custom`, so a step that is leaving moves the way of the
  // current navigation (AnimatePresence hands exiting steps the latest value).
  const variants = {
    enter: (dir: 1 | -1) => (reduce ? { opacity: 0 } : { opacity: 0, x: 12 * dir }),
    center: reduce
      ? { opacity: 1, transition: reducedTransition }
      : { opacity: 1, x: 0, transition: spring.smooth },
    exit: (dir: 1 | -1) =>
      reduce
        ? { opacity: 0, transition: reducedTransition }
        : { opacity: 0, x: -8 * dir, transition: tween.exit },
  };

  return (
    <div className="bg-background flex min-h-svh flex-col">
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-5">
        <div className="flex items-center gap-2">
          <LogoMark name={brand.name} />
          <span className="font-display text-foreground text-sm font-semibold tracking-[-0.01em]">
            {brand.name}
          </span>
        </div>
        <Progress index={index} count={count} label={stepLabel} />
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onExit}>
            {exitLabel}
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-5 pt-[min(10vh,6rem)] pb-16">
        <div className="flex w-full max-w-[30rem] flex-col">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={stepKey}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

/**
 * One step: its content, then Back and the step's actions. Enter continues from anywhere that has
 * no Enter of its own (the page, a choice card, the theme switch); text inputs submit their own
 * form, the step's (which continues) or a sub-form's like "Create invite link". A page-local key,
 * like a dialog's, not a registry shortcut: the app's shortcuts aren't bound on this page.
 */
export function Step({
  onContinue,
  onBack,
  footer,
  children,
}: {
  /** What Enter does outside inputs; null while the step can't continue. */
  onContinue: (() => void) | null;
  onBack: (() => void) | null;
  footer: ReactNode;
  children: ReactNode;
}) {
  const continueRef = useRef(onContinue);
  useEffect(() => {
    continueRef.current = onContinue;
  });
  const ref = useRef<HTMLDivElement>(null);

  // The step starts with focus at its top, so a screen reader reads the new heading and Tab starts
  // there; its main field (`data-autofocus`) takes focus instead, except on touch screens. This runs
  // when the step mounts, which is after the previous one has left.
  useEffect(() => {
    const step = ref.current;
    if (!step) return;
    const field = step.querySelector<HTMLElement>("[data-autofocus]");
    (field && canAutoFocus() ? field : step).focus({ preventScroll: true });
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    // Radios have no Enter of their own (Base UI's swallow it with preventDefault): it continues.
    const isChoice = target.closest('[role="radio"], input[type="radio"]');
    if (!isChoice && event.defaultPrevented) return;
    if (!isChoice && target.closest("button, a, input, textarea, select, [contenteditable]"))
      return;
    event.preventDefault();
    continueRef.current?.();
  }

  return (
    <div ref={ref} tabIndex={-1} onKeyDown={onKeyDown} className="flex flex-col gap-6 outline-none">
      {children}
      <div className="flex items-center gap-2 pt-2">
        {onBack && (
          <Button variant="ghost" onClick={onBack} data-icon="inline-start">
            <ArrowLeftIcon />
            Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}

/** "Your work · 1 of 5" over a row of short bars that fill as you go. */
function Progress({ index, count, label }: { index: number; count: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-muted-foreground text-xs" aria-live="polite">
        <span className="text-foreground">{label}</span>
        <span className="sr-only">, step</span>
        <span aria-hidden> · </span>
        <span className="tabular font-mono">
          {index + 1} of {count}
        </span>
      </span>
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: count }, (_, step) => (
          <span
            key={step}
            className={cn(
              "h-1 w-6 rounded-full transition-colors duration-(--duration-standard)",
              step <= index ? "bg-foreground" : "bg-border-strong",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Heading and a line under it: the top of every step. */
export function StepHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-foreground text-xl font-semibold tracking-[-0.01em] text-balance">
        {title}
      </h1>
      {children && <p className="text-muted-foreground text-sm text-pretty">{children}</p>}
    </div>
  );
}

/** The step's action, with the ↵ hint when it's the primary one. */
export function ContinueButton({
  children = "Continue",
  pending = false,
  disabled = false,
  form,
  onClick,
  variant = "default",
}: {
  children?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  /** Submit this form instead of clicking (steps whose inputs continue on Enter). */
  form?: string;
  onClick?: () => void;
  variant?: "default" | "secondary" | "ghost";
}) {
  return (
    <Button
      type={form ? "submit" : "button"}
      form={form}
      onClick={onClick}
      variant={variant}
      disabled={pending || disabled}
    >
      {children}
      {variant === "default" && <Keycap keys="enter" className="-mr-1" aria-hidden />}
    </Button>
  );
}
