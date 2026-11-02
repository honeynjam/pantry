import { brand } from "@pantry/backend/brand";

/**
 * What the API tokens screen tells people to paste (spec §10b, client docs checked 26 Oct 2026):
 * Claude Code takes a header on `claude mcp add`; Cursor's mcp.json takes `url` + `headers`, with the
 * token read from an environment variable so it stays out of the file.
 *
 * Claude (claude.ai, Desktop, mobile) and ChatGPT can't send a header: they take only the URL and
 * sign in over OAuth (convex/oauth.ts), so they get click-steps instead (checked 2 Nov 2026).
 */

/** The server name clients register us under, e.g. "pantry". */
export const MCP_SERVER_NAME = brand.name.toLowerCase();

/** The environment variable the Cursor snippet reads, e.g. PANTRY_TOKEN. */
export const TOKEN_ENV_VAR = `${brand.name.toUpperCase()}_TOKEN`;

/** Shown in the snippets until a token has just been created on this screen. */
export const TOKEN_PLACEHOLDER = "<your-token>";

/** The MCP endpoint of the instance the app is served from. */
export const mcpUrl = (origin: string) => `${origin.replace(/\/+$/, "")}/api/mcp`;

export function claudeCodeSnippet(url: string, token = TOKEN_PLACEHOLDER) {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`;
}

export function cursorSnippet(url: string) {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: { url, headers: { Authorization: `Bearer \${env:${TOKEN_ENV_VAR}}` } },
      },
    },
    null,
    2,
  );
}

export function cursorEnvSnippet(token = TOKEN_PLACEHOLDER) {
  return `export ${TOKEN_ENV_VAR}=${token}`;
}

/** The steps for apps that connect with just the URL and a sign-in (MCP OAuth). */
export const CONNECTOR_STEPS = {
  claude: [
    "In Claude (claude.ai or the desktop app), open Customize → Connectors.",
    `Click + → Add custom connector, name it ${brand.name} and paste the URL below.`,
    `Click Connect, sign in to ${brand.name} if asked, and press Allow.`,
  ],
  chatgpt: [
    "In ChatGPT, open Settings → Apps → Advanced settings and turn on Developer mode.",
    `Click Create app, name it ${brand.name}, paste the URL below and choose OAuth.`,
    `Click Create, sign in to ${brand.name} if asked, and press Allow. In a chat, add it from the + menu.`,
  ],
} as const;
