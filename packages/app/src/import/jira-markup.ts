/**
 * Jira's wiki markup (what its CSV export has in Description and Comment) → Markdown, for the common
 * parts: headings, bold, italic, strike, monospace, code and noformat blocks, quotes, lists, links,
 * mentions and tables. Anything else is left as it is: still readable, just not formatted.
 */
export function jiraToMarkdown(
  text: string,
  people: (id: string) => string | undefined = () => undefined,
): string {
  if (!text) return "";
  const out: string[] = [];
  const lines = text
    .replace(/\r\n?/g, "\n")
    // A one-line {quote}…{quote} is a bq.
    .replace(/^[ \t]*\{quote\}(.+?)\{quote\}[ \t]*$/gm, "bq. $1")
    .split("\n");
  let fence: string | null = null;
  let inQuote = false;
  for (const raw of lines) {
    // {code:java} … {code}, {noformat} … {noformat}
    const block = /^\s*\{(code|noformat)(?::([^}|]*))?[^}]*\}(.*)$/.exec(raw);
    if (fence) {
      const close = `{${fence}}`;
      const end = raw.indexOf(close);
      if (end >= 0) {
        if (raw.slice(0, end).trim()) out.push(raw.slice(0, end));
        out.push("```");
        fence = null;
        const rest = raw.slice(end + close.length).trim();
        if (rest) out.push(inline(rest, people));
      } else out.push(raw);
      continue;
    }
    if (block) {
      const kind = block[1]!;
      const language = kind === "code" ? (block[2] ?? "").trim() : "";
      const rest = block[3] ?? "";
      const end = rest.indexOf(`{${kind}}`);
      out.push(`\`\`\`${/^[\w+-]+$/.test(language) ? language : ""}`);
      if (end >= 0) {
        if (rest.slice(0, end)) out.push(rest.slice(0, end));
        out.push("```");
      } else {
        if (rest.trim()) out.push(rest);
        fence = kind;
      }
      continue;
    }
    if (/^\s*\{quote\}\s*$/.test(raw)) {
      inQuote = !inQuote;
      continue;
    }
    let line = raw;
    const heading = /^\s*h([1-6])\.\s+(.*)$/.exec(line);
    if (heading) line = `${"#".repeat(Number(heading[1]))} ${inline(heading[2]!, people)}`;
    else if (/^\s*bq\.\s+/.test(line))
      line = `> ${inline(line.replace(/^\s*bq\.\s+/, ""), people)}`;
    else if (/^\s*----\s*$/.test(line)) line = "---";
    else {
      const bullet = /^\s*([*#-]+)\s+(.*)$/.exec(line);
      if (bullet && /^[*#-]+$/.test(bullet[1]!) && !/^-{2,}$/.test(bullet[1]!)) {
        const marks = bullet[1]!;
        const depth = marks.length - 1;
        const ordered = marks.endsWith("#");
        line = `${"  ".repeat(depth)}${ordered ? "1." : "-"} ${inline(bullet[2]!, people)}`;
      } else if (/^\s*\|\|/.test(line)) {
        const cells = line
          .trim()
          .replace(/^\|\||\|\|$/g, "")
          .split("||");
        line = `| ${cells.map((cell) => inline(cell.trim(), people)).join(" | ")} |\n|${cells.map(() => " --- ").join("|")}|`;
      } else if (/^\s*\|/.test(line)) {
        const cells = line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|");
        line = `| ${cells.map((cell) => inline(cell.trim(), people)).join(" | ")} |`;
      } else line = inline(line, people);
    }
    out.push(inQuote ? `> ${line}` : line);
  }
  if (fence) out.push("```");
  return out.join("\n").trim();
}

function inline(text: string, people: (id: string) => string | undefined): string {
  const code: string[] = [];
  let line = text
    // {{monospace}} first, so nothing inside it is touched.
    .replace(/\{\{([^}]+)\}\}/g, (_, inner: string) => {
      code.push(`\`${inner}\``);
      return `\uE000${code.length - 1}\uE000`;
    })
    // [~accountid:5b10…] and [~username]
    .replace(/\[~(?:accountid:)?([^\]]+)\]/g, (_, id: string) => `@${people(id) ?? id}`)
    // [text|https://…] and [https://…]
    .replace(
      /\[([^\]|]+)\|([^\]]+)\]/g,
      (_, label: string, url: string) => `[${label}](${url.trim()})`,
    )
    .replace(/\[((?:https?|mailto):[^\]\s]+)\]/g, "<$1>")
    // !image.png! and !image.png|thumbnail!
    .replace(/!([^!\s|]+\.(?:png|jpe?g|gif|svg|webp))(?:\|[^!]*)?!/gi, "(image: $1)")
    .replace(/\{color(?::[^}]*)?\}/g, "");
  line = line
    .replace(/(^|[\s(])\*(\S(?:[^*]*\S)?)\*(?=[\s).,:;!?]|$)/g, "$1**$2**")
    .replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=[\s).,:;!?]|$)/g, "$1*$2*")
    .replace(/(^|[\s(])-(\S(?:[^-]*\S)?)-(?=[\s).,:;!?]|$)/g, "$1~~$2~~")
    .replace(/(^|[\s(])\+(\S(?:[^+]*\S)?)\+(?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])\?\?(\S(?:.*?\S)?)\?\?(?=[\s).,:;!?]|$)/g, "$1*$2*");
  return line.replace(/\uE000(\d+)\uE000/g, (_, index: string) => code[Number(index)]!);
}
