import { helpSections } from "@pantry/app/shortcuts";
import type { TocItem } from "@/lib/docs/markdown";
import { Keys } from "@/components/keys";

const groupId = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function shortcutsToc(): TocItem[] {
  return helpSections().map((section) => ({ id: groupId(section.group), text: section.group, depth: 2 as const }));
}

/** The same list the app's `?` help shows, read from its shortcut registry. */
export function ShortcutsReference() {
  return (
    <div className="docs-prose">
      <p>
        Press <code>?</code> anywhere in the app to see this list. Shortcuts are shown with Mac keys; on Windows and
        Linux, ⌘ is Ctrl. Single-letter shortcuts don&apos;t fire while you&apos;re typing.
      </p>
      {helpSections().map((section) => (
        <section key={section.group}>
          <h2 id={groupId(section.group)}>
            <a href={`#${groupId(section.group)}`} className="heading-anchor">
              {section.group}
            </a>
          </h2>
          {section.where && <p>{section.where}.</p>}
          <table>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.id}>
                  <td className="w-44">
                    <Keys keys={row.keys} size="md" />
                  </td>
                  <td>
                    {row.label}
                    {row.where && <span className="text-muted-foreground"> ({row.where.toLowerCase()})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
