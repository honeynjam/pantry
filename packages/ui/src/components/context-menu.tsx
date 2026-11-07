"use client";

import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@pantry/ui/components/dropdown-menu";

/**
 * Right-click menu (Base UI Context Menu). Its items, groups, separators and submenus are Base UI's
 * Menu parts, the same ones the dropdown menu restyles, so they're shared rather than copied: a
 * context menu looks and moves exactly like a dropdown, it just opens at the pointer.
 *
 * One menu can serve a whole list: wrap the list in `ContextMenuArea` (`className="contents"` keeps
 * the layout) and read which row was right-clicked in its `onContextMenu`. Text fields and selected
 * text keep the browser's own menu. Small areas can be a `ContextMenuTrigger` directly.
 * Keyboard: Shift+F10 or the context-menu key opens it on the focused element (`openContextMenuAt`).
 */
function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

/** Synthetic events `openContextMenuAt` dispatched, so they aren't re-anchored again. */
const anchored = new WeakSet<Event>();

/**
 * A contextmenu event from the keyboard (Shift+F10, the context-menu key) carries no useful pointer
 * position: Chrome reports `pointerType: ""`, older engines report (0, 0).
 */
function fromKeyboard(event: MouseEvent): boolean {
  if (anchored.has(event)) return false;
  const pointerType = (event as PointerEvent).pointerType;
  if (pointerType === "") return true;
  return pointerType === undefined && event.clientX === 0 && event.clientY === 0;
}

/**
 * Open the context menu that contains `element`, anchored at its bottom-left corner, as if it had
 * been right-clicked there. Returns whether a menu took it.
 */
function openContextMenuAt(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2,
    clientX: rect.left + Math.min(12, rect.width / 2),
    clientY: rect.bottom,
    view: element.ownerDocument.defaultView,
  });
  anchored.add(event);
  return !element.dispatchEvent(event);
}

/** Text fields, editors and selected text keep the browser's menu (copy, paste, spelling). */
function wantsNativeMenu(event: React.MouseEvent): boolean {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return false;
  if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"))
    return true;
  const selection = target.ownerDocument.getSelection();
  return Boolean(
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    selection.containsNode(target, true),
  );
}

/**
 * Let this right-click through to the browser (or to nothing): Base UI's handler and its
 * document-level `preventDefault` are skipped.
 */
function skipContextMenu(event: React.MouseEvent) {
  (event as React.MouseEvent & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
  event.stopPropagation();
}

function ContextMenuTrigger({ onContextMenu, ...props }: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onContextMenu={(event) => {
        if (wantsNativeMenu(event)) return skipContextMenu(event);
        // From the keyboard: re-dispatch at the focused element so the menu opens next to it.
        if (fromKeyboard(event.nativeEvent)) {
          skipContextMenu(event);
          event.preventDefault();
          openContextMenuAt(event.target as Element);
          return;
        }
        onContextMenu?.(event);
      }}
      {...props}
    />
  );
}

/**
 * The right-clickable area for long lists. Everything inside a `ContextMenuTrigger` sits inside the
 * menu's React context, so in a 600-row list every row's own menu trigger (its pickers) re-rendered
 * on each right-click. The area keeps the list outside the menu: it decides (`onContextMenu`
 * returns false to leave the browser's menu alone) and forwards the right-click, at the same point,
 * to the menu's `trigger`, which renders empty and hidden (`<ContextMenuTrigger ref={…} hidden />`).
 */
function ContextMenuArea({
  trigger,
  onContextMenu,
  ...props
}: Omit<React.ComponentProps<"div">, "onContextMenu"> & {
  trigger: React.RefObject<HTMLElement | null>;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => boolean | void;
}) {
  return (
    <div
      data-slot="context-menu-area"
      onContextMenu={(event) => {
        if (wantsNativeMenu(event)) return;
        // From the keyboard: start again from the focused element, so the menu opens next to it.
        if (fromKeyboard(event.nativeEvent)) {
          event.preventDefault();
          openContextMenuAt(event.target as Element);
          return;
        }
        if (onContextMenu(event) === false || !trigger.current) return;
        event.preventDefault();
        event.stopPropagation();
        const forwarded = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: event.clientX,
          clientY: event.clientY,
          view: trigger.current.ownerDocument.defaultView,
        });
        anchored.add(forwarded);
        trigger.current.dispatchEvent(forwarded);
      }}
      {...props}
    />
  );
}

/** The popup: the dropdown's surface and motion, placed at the pointer. */
function ContextMenuContent({
  side = "bottom",
  align = "start",
  sideOffset = 2,
  alignOffset = 2,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="context-menu-content"
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuArea,
  ContextMenuContent,
  openContextMenuAt,
  skipContextMenu,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuRadioGroup as ContextMenuRadioGroup,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
  DropdownMenuSub as ContextMenuSub,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
  DropdownMenuSubContent as ContextMenuSubContent,
};
