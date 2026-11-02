import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

/**
 * The slice of Convex the tools and the OAuth endpoints use. In the app it's a ConvexHttpClient; tests pass a fake. No
 * auth is set on the client: every MCP function takes the caller's token as an argument and checks
 * it itself, so one client can serve every request.
 */
export type Backend = {
  query<F extends FunctionReference<"query">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
  mutation<F extends FunctionReference<"mutation">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
  action<F extends FunctionReference<"action">>(
    fn: F,
    args: FunctionArgs<F>,
  ): Promise<FunctionReturnType<F>>;
};

export function convexBackend(convexUrl: string): Backend {
  const client = new ConvexHttpClient(convexUrl);
  return {
    query: (fn, args) => client.query(fn, args),
    mutation: (fn, args) => client.mutation(fn, args),
    action: (fn, args) => client.action(fn, args),
  };
}
