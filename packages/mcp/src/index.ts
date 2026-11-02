// MCP tool definitions (zod schemas + handlers that call Convex) and the MCP OAuth endpoints,
// used by apps/web (/api/mcp, /api/oauth/*, /.well-known/*).
export { createVerifyToken, type PantryAuthExtra } from "./auth";
export { convexBackend, type Backend } from "./backend";
export {
  authorizationServerMetadata,
  createOAuthHandlers,
  OAUTH_PATHS,
  protectedResourceMetadata,
  type OAuthHandlers,
} from "./oauth";
export { registerTools, schemas, SERVER_INSTRUCTIONS, tools, type ToolName } from "./tools";
