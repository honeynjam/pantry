import { toolDocs, TOOL_GROUPS, type ToolDoc } from "@/lib/docs/mcp";
import type { TocItem } from "@/lib/docs/markdown";

const groupId = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function mcpToolsToc(): TocItem[] {
  return TOOL_GROUPS.map((group) => ({ id: groupId(group.title), text: group.title, depth: 2 as const }));
}

/** Every MCP tool, grouped, from packages/mcp's own definitions. */
export function McpToolsReference() {
  const docs = new Map(toolDocs().map((doc) => [doc.name, doc]));
  return (
    <div className="docs-prose">
      <p>
        These are the tools your agent sees, with the same names, descriptions and parameters. Every call acts as the
        token&apos;s owner, inside their workspace only. Issue keys look like <code>PAN-42</code>; spaces are given by
        key, and statuses, labels, projects and people by name (case-insensitive).
      </p>
      {TOOL_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 id={groupId(group.title)}>
            <a href={`#${groupId(group.title)}`} className="heading-anchor">
              {group.title}
            </a>
          </h2>
          <p>{group.body}</p>
          {group.tools.map((name) => {
            const doc = docs.get(name);
            return doc ? <Tool key={name} doc={doc} /> : null;
          })}
        </section>
      ))}
    </div>
  );
}

function Tool({ doc }: { doc: ToolDoc }) {
  return (
    <div className="not-prose mt-8 rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={doc.name} className="font-mono text-[0.9375rem] font-medium tracking-normal">
          <a href={`#${doc.name}`} className="heading-anchor">
            {doc.name}
          </a>
        </h3>
        <span className="text-sm text-muted-foreground">{doc.title}</span>
        <span className="ml-auto flex gap-1.5">
          {doc.readOnly ? <Badge>Read-only</Badge> : <Badge>Changes data</Badge>}
          {doc.destructive && <Badge danger>Can&apos;t be undone</Badge>}
        </span>
      </div>
      <p className="mt-3! text-[0.9375rem] leading-7 text-muted-foreground">{doc.description}</p>
      {doc.params.length > 0 && (
        <div className="mt-4! overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Parameter</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {doc.params.map((param) => (
                <tr key={param.name} className="border-b border-border last:border-0 align-top">
                  <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap">
                    {param.name}
                    {param.required && <span className="ml-1 text-[var(--priority-urgent)]">*</span>}
                  </td>
                  <td className="max-w-48 py-2.5 pr-4 font-mono text-xs text-muted-foreground">{param.type}</td>
                  <td className="py-2.5 text-muted-foreground">{param.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2! text-xs text-muted-foreground">
            <span className="text-[var(--priority-urgent)]">*</span> required
          </p>
        </div>
      )}
    </div>
  );
}

function Badge({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <span
      className={
        danger
          ? "rounded-full border border-[var(--priority-urgent)] px-2 py-0.5 text-xs text-[var(--priority-urgent)]"
          : "rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}
