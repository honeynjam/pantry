"use client";

import { api } from "@pantry/backend/api";
import type { Id } from "@pantry/backend/dataModel";
import { Button } from "@pantry/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@pantry/ui/components/field";
import { Input } from "@pantry/ui/components/input";
import { SegmentedControl } from "@pantry/ui/components/segmented-control";
import { randomPantryAvatar } from "@pantry/ui/lib/pantry-avatars";
import { useMutation } from "convex/react";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SpaceAvatar } from "../components/space-avatar";
import { suggestKey } from "../components/new-space-dialog";
import { KIND_LABEL, kindOf, vocabulary, type Kind, type Mode } from "../lib/vocabulary";
import { describeError, FormError } from "../screens/form-error";
import type { WorkspaceData } from "../shell/app-shell";
import { ContinueButton, Step, StepHeader } from "./frame";

const FORM_ID = "onboarding-spaces";
const MAX_ROWS = 8;
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const KEY_CODES = new Set(["INVALID_KEY", "KEY_TAKEN", "KEY_FIXED"]);

type Row = {
  id: string;
  /** Set for setup's untouched sample, which is renamed in place rather than created. */
  spaceId?: Id<"spaces">;
  name: string;
  /** null: follow the name's suggestion until a key is typed. */
  key: string | null;
  kind: Kind;
  summary: string;
  errors: { name?: string; key?: string; form?: string };
};

export type Sample = { spaceId: Id<"spaces">; name: string; key: string } | null;

let nextRowId = 0;
const blankRow = (kind: Kind): Row => ({
  id: `row-${++nextRowId}`,
  name: "",
  key: null,
  kind,
  summary: "",
  errors: {},
});
const keyOf = (row: Row) => row.key ?? suggestKey(row.name);
const errorCode = (err: unknown) =>
  (err as { data?: { code?: unknown } } | null)?.data?.code as string | undefined;

/**
 * Step 2 (owner): name the first products or clients. Setup's sample, while nobody has used it, is
 * offered for renaming (name and key) instead of being left around as a demo; more can be added
 * under it. Each can take one line for its context doc. Spaces that already exist are listed, not
 * recreated, so running setup again only adds what's new.
 */
export function SpacesStep({
  data,
  mode,
  sample,
  onBack,
  onDone,
}: {
  data: WorkspaceData;
  mode: Mode;
  sample: Sample;
  onBack: () => void;
  /** With the key of the first space named here, if any (Finish lands there). */
  onDone: (firstKey: string | null) => void;
}) {
  const words = vocabulary(mode);
  const updateSpace = useMutation(api.spaces.update);
  const createSpace = useMutation(api.spaces.create);
  const describeSpace = useMutation(api.onboarding.describeSpace);
  const [rows, setRows] = useState<Row[]>(() => {
    if (sample) {
      return [
        {
          ...blankRow(words.defaultKind),
          id: "sample",
          spaceId: sample.spaceId,
          name: sample.name,
        },
      ];
    }
    return data.spaces.length === 0 ? [blankRow(words.defaultKind)] : [];
  });
  const [pending, setPending] = useState(false);
  const existing = data.spaces.filter((space) => !rows.some((row) => row.spaceId === space._id));

  function patch(id: string, change: Partial<Row>) {
    setRows((list) =>
      list.map((row) =>
        row.id === id
          ? // Editing a field clears its error; the rest wait for the next Continue.
            {
              ...row,
              ...change,
              errors: {
                ...row.errors,
                ...("name" in change ? { name: undefined, form: undefined } : {}),
                ...("key" in change || "name" in change ? { key: undefined } : {}),
              },
            }
          : row,
      ),
    );
  }

  /** Errors a person can fix before anything is sent: empty names, bad or repeated keys. */
  function check(list: Row[]): Row[] {
    const taken = new Map(existing.map((space) => [space.key, space.name]));
    return list.map((row) => {
      const key = keyOf(row);
      const errors: Row["errors"] = {};
      if (!row.name.trim()) errors.name = "Give it a name.";
      if (!KEY_PATTERN.test(key)) errors.key = "2–10 letters or digits, starting with a letter.";
      else if (taken.has(key)) errors.key = `${key} is already the key of ${taken.get(key)}.`;
      taken.set(key, row.name.trim() || "another row");
      return { ...row, errors };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // New rows left empty are dropped; the sample keeps its row (it already exists).
    const filled = rows.filter((row) => row.spaceId || row.name.trim() || row.summary.trim());
    const checked = check(filled);
    setRows(checked);
    if (checked.some((row) => Object.values(row.errors).some(Boolean))) return;

    setPending(true);
    let firstKey: string | null = null;
    const left: Row[] = [];
    for (const row of checked) {
      const name = row.name.trim();
      const key = keyOf(row);
      let spaceId = row.spaceId;
      try {
        if (spaceId) {
          await updateSpace({ spaceId, name, key, kind: row.kind });
        } else {
          spaceId = (await createSpace({ name, key, kind: row.kind, avatar: randomPantryAvatar() }))
            .spaceId;
        }
        firstKey ??= key;
      } catch (err) {
        const message = describeError(err, `Couldn't save ${name}. Try again.`);
        const errors = KEY_CODES.has(errorCode(err) ?? "") ? { key: message } : { form: message };
        left.push({ ...row, errors });
        continue;
      }
      // The space exists now, so a failed summary doesn't keep its row (that would create it twice).
      if (row.summary.trim()) {
        await describeSpace({ spaceId, summary: row.summary }).catch((err: unknown) =>
          toast.error(describeError(err, `Couldn't add the line to ${name}'s context doc.`)),
        );
      }
    }
    setPending(false);
    setRows(left);
    if (left.length === 0) onDone(firstKey);
  }

  const title =
    mode === "both"
      ? "Your products and clients"
      : mode === "client"
        ? "Your clients"
        : "Your products";
  const noun = words.one;

  return (
    <Step
      onBack={onBack}
      onContinue={() =>
        (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
      }
      footer={
        <ContinueButton form={FORM_ID} pending={pending}>
          {pending ? "Saving…" : "Continue"}
        </ContinueButton>
      }
    >
      <StepHeader title={title}>
        Each {mode === "both" ? "one" : noun} gets its own issues, key and context doc, the page
        your agents read before they start.
      </StepHeader>

      {existing.length > 0 && (
        <section aria-labelledby="onboarding-existing" className="flex flex-col gap-2">
          <h2
            id="onboarding-existing"
            className="text-muted-foreground font-sans text-xs font-medium tracking-normal"
          >
            Already here
          </h2>
          <ul className="divide-border border-border flex flex-col divide-y rounded-lg border">
            {existing.map((space) => (
              <li key={space._id} className="h-row flex items-center gap-3 px-3 text-sm">
                <SpaceAvatar space={space} size="sm" />
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                  {space.name}
                </span>
                {(words.asksKind || kindOf(space) !== words.defaultKind) && (
                  <span className="text-muted-foreground text-xs">
                    {KIND_LABEL[kindOf(space)].one}
                  </span>
                )}
                <span className="text-muted-foreground font-mono text-xs">{space.key}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <SpaceRow
            key={row.id}
            row={row}
            sampleName={row.spaceId ? sample?.name : undefined}
            sampleKey={row.spaceId ? sample?.key : undefined}
            asksKind={words.asksKind}
            autoFocus={index === 0}
            onChange={(change) => patch(row.id, change)}
            onRemove={
              row.spaceId ? null : () => setRows((list) => list.filter((r) => r.id !== row.id))
            }
          />
        ))}
        {rows.length < MAX_ROWS && (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground self-start"
            data-icon="inline-start"
            onClick={() => setRows((list) => [...list, blankRow(words.defaultKind)])}
          >
            <PlusIcon />
            {rows.length === 0 && existing.length === 0
              ? `Add a ${noun}`
              : mode === "both"
                ? "Add another"
                : `Add another ${noun}`}
          </Button>
        )}
      </form>
    </Step>
  );
}

function SpaceRow({
  row,
  sampleName,
  sampleKey,
  asksKind,
  autoFocus,
  onChange,
  onRemove,
}: {
  row: Row;
  sampleName?: string;
  sampleKey?: string;
  asksKind: boolean;
  autoFocus: boolean;
  onChange: (change: Partial<Row>) => void;
  onRemove: (() => void) | null;
}) {
  const id = (field: string) => `${row.id}-${field}`;
  const key = keyOf(row);
  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
      {sampleName && (
        <p className="text-muted-foreground text-xs">
          Setup made a sample, {sampleName} ({sampleKey}). Rename it to make it yours; it has no
          issues yet, so the key can change too.
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-2">
        <Field data-invalid={row.errors.name ? true : undefined}>
          <FieldLabel htmlFor={id("name")}>Name</FieldLabel>
          <Input
            id={id("name")}
            value={row.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder={row.kind === "client" ? "e.g. Acme Ltd" : "e.g. Mobile app"}
            aria-invalid={row.errors.name ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-autofocus={autoFocus ? "" : undefined}
          />
          {row.errors.name && <FieldError>{row.errors.name}</FieldError>}
        </Field>
        <Field data-invalid={row.errors.key ? true : undefined}>
          <FieldLabel htmlFor={id("key")}>Key</FieldLabel>
          <Input
            id={id("key")}
            value={key}
            onChange={(event) =>
              onChange({
                key: event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 10),
              })
            }
            className="font-mono uppercase"
            aria-invalid={row.errors.key ? true : undefined}
            aria-describedby={id("key-hint")}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
          />
        </Field>
      </div>
      {row.errors.key ? (
        <FieldError id={id("key-hint")}>{row.errors.key}</FieldError>
      ) : (
        <FieldDescription id={id("key-hint")} className="-mt-1 text-xs">
          Issues get keys like <span className="text-foreground font-mono">{key || "KEY"}-1</span>.
          The key is fixed once the first issue exists.
        </FieldDescription>
      )}
      {asksKind && (
        <SegmentedControl
          aria-label="Kind"
          size="sm"
          value={row.kind}
          onValueChange={(kind) => onChange({ kind })}
          options={[
            { value: "product", label: KIND_LABEL.product.one },
            { value: "client", label: KIND_LABEL.client.one },
          ]}
        />
      )}
      <Field>
        <FieldLabel htmlFor={id("summary")}>
          In one line, what is it?{" "}
          <span className="text-muted-foreground font-normal">Optional</span>
        </FieldLabel>
        <Input
          id={id("summary")}
          value={row.summary}
          onChange={(event) => onChange({ summary: event.target.value })}
          maxLength={300}
          placeholder={
            row.kind === "client"
              ? "e.g. Brand site and shop for a London bakery"
              : "e.g. An issue tracker for small teams working with agents"
          }
          autoComplete="off"
        />
        <FieldDescription className="text-xs">
          Goes at the top of its context doc. You can write the rest later.
        </FieldDescription>
      </Field>
      <FormError message={row.errors.form ?? null} />
      {onRemove && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground -mt-1 self-end"
          data-icon="inline-start"
          onClick={onRemove}
        >
          <XIcon />
          Remove
        </Button>
      )}
    </div>
  );
}
