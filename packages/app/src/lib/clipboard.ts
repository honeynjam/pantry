import { toast } from "sonner";

/** Copy `text` and say what was copied ("Copied PAN-12"), or that the browser said no. */
export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    toast.error("Couldn't copy: the browser blocked the clipboard.");
  }
}

/** The full URL of an app path, for links people paste elsewhere. */
export const absoluteUrl = (path: string) => `${window.location.origin}${path}`;

/** Open an app path in a new browser tab. */
export function openInNewTab(path: string) {
  window.open(absoluteUrl(path), "_blank", "noopener,noreferrer");
}
