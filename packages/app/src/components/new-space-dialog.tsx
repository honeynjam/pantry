"use client";

import { api } from "@pantry/backend/api";
import { Button } from "@pantry/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pantry/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@pantry/ui/components/field";
import { Input } from "@pantry/ui/components/input";
import { PantryAvatarPicker } from "@pantry/ui/components/pantry-avatar-picker";
import { SegmentedControl } from "@pantry/ui/components/segmented-control";
import { randomPantryAvatar } from "@pantry/ui/lib/pantry-avatars";
import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { routes, useNavigation } from "../navigation";
import { describeError, FormError } from "../screens/form-error";
import { KIND_LABEL, vocabulary, type Kind, type Mode } from "../lib/vocabulary";

/** "Web app" → "WEB"; "2nd brain" → "ND" (keys start with a letter). */
export function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 3);
}

/**
 * Name, kind and key; the key is suggested from the name until you type your own. Opens the new
 * space. The words and the kind follow the workspace's mode: a product or client workspace makes
 * products or clients without asking; with both, it asks (starting on `kind` when given).
 */
export function NewSpaceDialog({
  open,
  onOpenChange,
  mode,
  kind: startKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  kind?: Kind;
}) {
  const createSpace = useMutation(api.spaces.create);
  const words = vocabulary(mode);
  const [chosenKind, setKind] = useState<Kind | null>(null);
  const kind = chosenKind ?? startKind ?? words.defaultKind;
  const noun = KIND_LABEL[kind].one.toLowerCase();
  const { navigate } = useNavigation();
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [avatar, setAvatar] = useState(randomPantryAvatar);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shownKey = key ?? suggestKey(name);

  function reset() {
    setName("");
    setKey(null);
    setAvatar(randomPantryAvatar());
    setKind(null);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await createSpace({ name, key: shownKey, kind, avatar });
      onOpenChange(false);
      reset();
      navigate(routes.space(created.key));
    } catch (err) {
      setError(describeError(err, `Couldn't create the ${noun}.`));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New {noun}</DialogTitle>
            <DialogDescription>
              Issues in it get keys like {shownKey || "KEY"}-1. The key can&apos;t change later.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="new-space-name">Name</FieldLabel>
              <div className="flex items-center gap-2">
                <PantryAvatarPicker
                  value={avatar}
                  onChange={setAvatar}
                  seed="new-space"
                  label={`${KIND_LABEL[kind].one} avatar`}
                  className="-my-1 -ml-1"
                />
                <Input
                  id="new-space-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={kind === "client" ? "e.g. Acme Ltd" : "e.g. Pantry"}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
            </Field>
            {words.asksKind && (
              <Field>
                <FieldLabel>Kind</FieldLabel>
                <SegmentedControl
                  aria-label="Kind"
                  value={kind}
                  onValueChange={setKind}
                  options={[
                    { value: "product", label: "Product" },
                    { value: "client", label: "Client" },
                  ]}
                />
                <FieldDescription>
                  One of your products, or client work. You can change it later.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="new-space-key">Key</FieldLabel>
              <Input
                id="new-space-key"
                value={shownKey}
                onChange={(event) =>
                  setKey(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 10),
                  )
                }
                className="font-mono uppercase"
                required
                minLength={2}
                maxLength={10}
                pattern="[A-Z][A-Z0-9]{1,9}"
                autoComplete="off"
              />
              <FieldDescription>2–10 letters or digits, starting with a letter.</FieldDescription>
            </Field>
          </FieldGroup>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || shownKey.length < 2}>
              {pending ? "Creating…" : `Create ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
