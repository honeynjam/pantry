import { tools, type ToolName } from "@pantry/mcp";
import { z } from "zod";

/**
 * The MCP tool reference, read from the server's own definitions (packages/mcp): names, titles,
 * descriptions and parameters can't drift from what agents actually see.
 *
 * Only the grouping is ours. docs.test.ts fails when a tool has no group, so a new tool shows up
 * in review with a prompt to place it (and mention it in the docs).
 */
export const TOOL_GROUPS: { title: string; body: string; tools: ToolName[] }[] = [
  {
    title: "Issues",
    body: "Read, find, create, change and comment on issues.",
    tools: [
      "get_issue",
      "list_issues",
      "search_issues",
      "create_issue",
      "create_sub_issue",
      "add_comment",
      "update_issue",
      "delete_issue",
    ],
  },
  {
    title: "Orientation and context",
    body: "See what exists, and read or rewrite the brief for a space.",
    tools: ["get_workspace", "get_space_context", "update_space_context"],
  },
  {
    title: "Organising",
    body: "Set up spaces, projects, labels and statuses.",
    tools: [
      "create_space",
      "update_space",
      "create_project",
      "update_project",
      "archive_project",
      "unarchive_project",
      "create_label",
      "update_status",
      "reorder_statuses",
    ],
  },
];

export const TOOL_NAMES = Object.keys(tools) as ToolName[];

export type ToolParam = { name: string; type: string; required: boolean; description: string };
export type ToolDoc = {
  name: ToolName;
  title: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  params: ToolParam[];
};

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  pattern?: string;
};

/** A short, readable type: `string`, `"high" | "low"`, `string[]`, `string or null`. */
function typeOf(schema: JsonSchema): string {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return [...new Set(variants.map(typeOf))].join(" or ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.type === "array") return `${schema.items ? typeOf(schema.items) : "unknown"}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(" or ");
  if (schema.type === "integer") return "number";
  return schema.type ?? "any";
}

function describe(schema: JsonSchema): string {
  return schema.description ?? (schema.anyOf ?? schema.oneOf ?? []).find((s) => s.description)?.description ?? "";
}

export function toolDocs(): ToolDoc[] {
  return TOOL_NAMES.map((name) => {
    const def = tools[name];
    const json = z.toJSONSchema(def.schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
    const required = new Set(json.required ?? []);
    return {
      name,
      title: def.title,
      description: def.description,
      readOnly: def.readOnly,
      destructive: "destructive" in def && def.destructive === true,
      params: Object.entries(json.properties ?? {}).map(([param, schema]) => ({
        name: param,
        type: typeOf(schema),
        required: required.has(param),
        description: describe(schema),
      })),
    };
  });
}
