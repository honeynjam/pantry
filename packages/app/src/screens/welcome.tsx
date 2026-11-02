"use client";

import { api } from "@pantry/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticUpdate } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";
import { EntryGate } from "../entry";
import { modeOf, vocabulary, type Mode } from "../lib/vocabulary";
import { useStable } from "../lib/stable";
import { routes, useNavigation } from "../navigation";
import { OnboardingFrame } from "../onboarding/frame";
import { useSetMode } from "../onboarding/mode-choice";
import { SpacesStep } from "../onboarding/spaces-step";
import { AgentStep, FinishStep, MemberWelcomeStep, TeamStep, WorkStep } from "../onboarding/steps";
import type { WorkspaceData } from "../shell/app-shell";
import { describeError } from "./form-error";
import { LoadingScreen } from "./loading";

type OnboardingState = FunctionReturnType<typeof api.onboarding.state>;
type StepId = "work" | "spaces" | "team" | "agent" | "finish" | "welcome";

const OWNER_STEPS: StepId[] = ["work", "spaces", "team", "agent", "finish"];
const MEMBER_STEPS: StepId[] = ["welcome", "agent", "finish"];

/**
 * Onboarding (spec §10 "First run"). The owner gets it right after setup: what they work on, their
 * first products or clients, invites, their agent, then theme and keys. Invited members get the
 * short version: welcome, agent, theme and keys. The app shell sends anyone who hasn't finished it
 * here once; Workspace settings and the user menu bring it back (`?again=1`), walking the same
 * steps with the current values and creating nothing twice.
 */
export function WelcomePage() {
  return <EntryGate allow={["ready"]}>{() => <Onboarding />}</EntryGate>;
}

function Onboarding() {
  const data = useStable(useQuery(api.workspace.current));
  const state = useQuery(api.onboarding.state);
  // The first state decides the steps and whether this is a re-run; later changes (a mode being
  // saved) mustn't reshuffle the flow mid-way. The sample offer stays live: once it's renamed, going
  // back to that step lists it instead of offering it again.
  const [initial, setInitial] = useState<OnboardingState | null>(null);
  if (state && !initial) setInitial(state);
  if (data === undefined || !initial || !state) return <LoadingScreen />;
  return <Flow data={data} state={initial} sample={state.sample} />;
}

/** The shell checks this flag: set it locally so landing in the app doesn't bounce back here. */
const markOnboarded: OptimisticUpdate<FunctionArgs<typeof api.onboarding.complete>> = (store) => {
  const current = store.getQuery(api.workspace.current, {});
  if (current) {
    store.setQuery(
      api.workspace.current,
      {},
      { ...current, me: { ...current.me, onboardedAt: Date.now() } },
    );
  }
};

function Flow({
  data,
  state,
  sample,
}: {
  data: WorkspaceData;
  state: OnboardingState;
  sample: OnboardingState["sample"];
}) {
  const { navigate, search } = useNavigation();
  const again = state.onboardedAt !== null || new URLSearchParams(search).has("again");
  const steps = state.isOwner ? OWNER_STEPS : MEMBER_STEPS;
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [mode, setModeChoice] = useState<Mode | null>(
    // A first run asks; a re-run (or a workspace that already chose) starts on the current mode.
    again || data.workspace.mode !== undefined ? modeOf(data.workspace) : null,
  );
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const setMode = useSetMode();
  const complete = useMutation(api.onboarding.complete).withOptimisticUpdate(markOnboarded);

  const step = steps[index]!;
  const words = vocabulary(mode ?? modeOf(data.workspace));
  const labels: Record<StepId, string> = {
    work: "Your work",
    spaces: words.many,
    team: "Your team",
    agent: "Your agent",
    finish: "Make it yours",
    welcome: "Welcome",
  };
  const landingSpace =
    data.spaces.find((space) => space.key === firstKey) ?? data.spaces[0] ?? null;

  function go(delta: 1 | -1) {
    setDirection(delta);
    setIndex((current) => Math.min(Math.max(current + delta, 0), steps.length - 1));
  }
  const next = () => go(1);
  const back = index > 0 ? () => go(-1) : null;

  async function saveMode() {
    if (!mode || pending) return;
    if (mode !== data.workspace.mode) {
      setPending(true);
      try {
        await setMode({ mode });
      } catch (err) {
        toast.error(describeError(err, "Couldn't save that. Try again."));
        return;
      } finally {
        setPending(false);
      }
    }
    next();
  }

  async function finish() {
    if (pending) return;
    setPending(true);
    try {
      await complete({});
      navigate(landingSpace ? routes.space(landingSpace.key) : routes.home, { replace: true });
    } catch (err) {
      setPending(false);
      toast.error(describeError(err, "Couldn't finish. Try again."));
    }
  }

  return (
    <OnboardingFrame
      stepKey={step}
      index={index}
      count={steps.length}
      stepLabel={labels[step]}
      direction={direction}
      exitLabel={again ? "Close" : state.isOwner ? "Skip setup" : "Skip"}
      onExit={() => void finish()}
    >
      {step === "work" && (
        <WorkStep
          value={mode}
          onChange={setModeChoice}
          pending={pending}
          onContinue={() => void saveMode()}
        />
      )}
      {step === "spaces" && (
        <SpacesStep
          data={data}
          mode={mode ?? modeOf(data.workspace)}
          sample={sample}
          onBack={back!}
          onDone={(key) => {
            if (key) setFirstKey(key);
            next();
          }}
        />
      )}
      {step === "team" && <TeamStep data={data} onBack={back!} onNext={next} />}
      {step === "welcome" && <MemberWelcomeStep data={data} onNext={next} />}
      {step === "agent" && <AgentStep onBack={back} onNext={next} />}
      {step === "finish" && (
        <FinishStep
          landing={landingSpace?.name ?? null}
          pending={pending}
          onBack={back!}
          onFinish={() => void finish()}
        />
      )}
    </OnboardingFrame>
  );
}
