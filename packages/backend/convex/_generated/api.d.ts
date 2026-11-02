/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as comments from "../comments.js";
import type * as docs from "../docs.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as issues from "../issues.js";
import type * as labels from "../labels.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_avatar from "../lib/avatar.js";
import type * as lib_brand from "../lib/brand.js";
import type * as lib_comments from "../lib/comments.js";
import type * as lib_defaults from "../lib/defaults.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_issues from "../lib/issues.js";
import type * as lib_model from "../lib/model.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_organise from "../lib/organise.js";
import type * as lib_priority from "../lib/priority.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_search from "../lib/search.js";
import type * as lib_signup from "../lib/signup.js";
import type * as lib_spaces from "../lib/spaces.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_validate from "../lib/validate.js";
import type * as lib_version from "../lib/version.js";
import type * as mcp from "../mcp.js";
import type * as migrations from "../migrations.js";
import type * as onboarding from "../onboarding.js";
import type * as projects from "../projects.js";
import type * as setup from "../setup.js";
import type * as spaces from "../spaces.js";
import type * as statuses from "../statuses.js";
import type * as tokens from "../tokens.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  comments: typeof comments;
  docs: typeof docs;
  http: typeof http;
  invites: typeof invites;
  issues: typeof issues;
  labels: typeof labels;
  "lib/activity": typeof lib_activity;
  "lib/auth": typeof lib_auth;
  "lib/avatar": typeof lib_avatar;
  "lib/brand": typeof lib_brand;
  "lib/comments": typeof lib_comments;
  "lib/defaults": typeof lib_defaults;
  "lib/errors": typeof lib_errors;
  "lib/issues": typeof lib_issues;
  "lib/model": typeof lib_model;
  "lib/names": typeof lib_names;
  "lib/organise": typeof lib_organise;
  "lib/priority": typeof lib_priority;
  "lib/rules": typeof lib_rules;
  "lib/search": typeof lib_search;
  "lib/signup": typeof lib_signup;
  "lib/spaces": typeof lib_spaces;
  "lib/tokens": typeof lib_tokens;
  "lib/validate": typeof lib_validate;
  "lib/version": typeof lib_version;
  mcp: typeof mcp;
  migrations: typeof migrations;
  onboarding: typeof onboarding;
  projects: typeof projects;
  setup: typeof setup;
  spaces: typeof spaces;
  statuses: typeof statuses;
  tokens: typeof tokens;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
