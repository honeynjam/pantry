/**
 * Whether an issue drag is in progress. While it is, Escape, Enter and the arrow keys belong to the
 * drag (cancel, drop, move), so the list's own shortcuts stand aside. It clears a tick after the
 * drop: the key that ended the drag reaches the shortcut listener after dnd-kit's.
 */
let dragging = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export const issueDrag = {
  start() {
    clearTimeout(timer);
    dragging = true;
  },
  end() {
    clearTimeout(timer);
    timer = setTimeout(() => (dragging = false), 0);
  },
  get active() {
    return dragging;
  },
};
