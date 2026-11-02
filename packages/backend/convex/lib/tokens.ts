/**
 * Secrets (spec §10b): random 32 bytes, base64url, with a prefix. Generate them in actions only
 * (queries and mutations are deterministic); store only the SHA-256 hash.
 */

export const INVITE_TOKEN_PREFIX = "inv_";

/** `prefix` + 32 random bytes as base64url. Call from an action. */
export function randomToken(prefix: string): string {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of a string as unpadded base64url: the PKCE S256 transform (RFC 7636 §4.2). */
export async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64Url(new Uint8Array(digest));
}

/** SHA-256 of a token as lower-case hex. Deterministic, so safe in queries and mutations. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** How many leading characters of an API token the UI shows (`pan_x7Kq`), spec §10b. */
export const TOKEN_PREFIX_LENGTH = 8;

/** Longer than any token we hand out (prefix + 43 chars); anything bigger isn't worth hashing. */
export const MAX_TOKEN_LENGTH = 128;

/** `apiTokens.lastUsedAt` is written at most this often per token (spec §10b). */
export const TOKEN_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

/** Whether a token last used at `lastUsedAt` is due a new `lastUsedAt` write at `now`. */
export function shouldTouch(lastUsedAt: number | undefined, now: number): boolean {
  return lastUsedAt === undefined || now - lastUsedAt >= TOKEN_TOUCH_INTERVAL_MS;
}
